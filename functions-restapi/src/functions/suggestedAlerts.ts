// Suggested Alerts - the human-review queue for predictive alerts.
//   GET  /suggested-alerts?status=pending        - any staff role
//   POST /suggested-alerts/{id}/approve          - Publisher/Admin
//   POST /suggested-alerts/{id}/dismiss          - Publisher/Admin
//
// HANDOFF §2.3: predictive/automated decisions stay human-reviewed. NOTHING
// auto-publishes: detection feeds (Phase 3) only INSERT pending rows; a rider
// message exists only after a staff member approves here, and approval runs
// through the exact same Messages insert + Service Bus publish path as a
// manually composed announcement.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, STAFF_READ_ROLES, PUBLISH_ROLES } from "../lib/auth";
import { isGuid, validatePrepareSuggestedAlert } from "../lib/validation";
import { publishMessageCreated } from "../lib/events";
import type { Category, PrepareSuggestedAlertBody, Severity } from "../lib/types";

interface SuggestedAlertRow {
  alert_id: string;
  source: string;
  draft_text: string;
  category: Category;
  severity: Severity;
  routes_affected: string | null;
  zones_affected: string | null;
  detail: string | null;
  status: string;
  created_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  message_id: string | null;
}

async function linkPreparedAlertToRisk(
  tx: sql.Transaction,
  body: PrepareSuggestedAlertBody,
  alertId: string,
): Promise<void> {
  const tripId = body.detail.trip_id;
  if (typeof tripId !== "string" || tripId === "") return;

  const linkReq = new sql.Request(tx);
  linkReq.input("trip_id", sql.NVarChar, tripId);
  linkReq.input("alert_id", sql.UniqueIdentifier, alertId);
  if (body.source === "gtfs_rt") {
    const serviceDate =
      typeof body.detail.service_date === "string"
        ? body.detail.service_date
        : null;
    linkReq.input("service_date", sql.NVarChar, serviceDate);
    await linkReq.query(`
      UPDATE MonitoredTripDelays
      SET suggested_alert_id = @alert_id
      WHERE trip_id = @trip_id
        AND (@service_date IS NULL OR service_date = @service_date)
    `);
  } else {
    await linkReq.query(`
      UPDATE MonitoredOnDemandWaits
      SET suggested_alert_id = @alert_id
      WHERE trip_id = @trip_id
    `);
  }
}

// Creates a reviewable draft from an OCC risk card. This endpoint never
// publishes. source + external_id is the idempotency key, so repeated clicks
// and the background detector converge on one review item.
app.http("suggestedAlertsPrepare", {
  route: "suggested-alerts/prepare",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const validationErrors = validatePrepareSuggestedAlert(
      raw as Record<string, unknown>,
    );
    if (validationErrors.length > 0) {
      return {
        status: 400,
        jsonBody: { error: "Validation failed", details: validationErrors },
      };
    }
    const body = raw as PrepareSuggestedAlertBody;

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const existingReq = new sql.Request(tx);
      existingReq.input("source", sql.NVarChar, body.source);
      existingReq.input("external_id", sql.NVarChar, body.external_id);
      const existing = await existingReq.query<{
        alert_id: string;
        status: string;
      }>(`
        SELECT alert_id, status
        FROM SuggestedAlerts WITH (UPDLOCK, HOLDLOCK)
        WHERE source = @source AND external_id = @external_id
      `);
      const prior = existing.recordset[0];
      if (prior) {
        await linkPreparedAlertToRisk(tx, body, prior.alert_id);
        await tx.commit();
        if (prior.status !== "pending") {
          return {
            status: 409,
            jsonBody: {
              error: `The alert for this risk was already ${prior.status}.`,
              alert_id: prior.alert_id,
              alert_status: prior.status,
            },
          };
        }
        return {
          status: 200,
          jsonBody: { alert_id: prior.alert_id, status: prior.status, created: false },
        };
      }

      const insertReq = new sql.Request(tx);
      insertReq.input("source", sql.NVarChar, body.source);
      insertReq.input("external_id", sql.NVarChar, body.external_id);
      insertReq.input("draft_text", sql.NVarChar, body.draft_text.trim());
      insertReq.input("category", sql.NVarChar, body.category);
      insertReq.input("severity", sql.NVarChar, body.severity);
      insertReq.input(
        "routes_affected",
        sql.NVarChar,
        body.routes_affected ? JSON.stringify(body.routes_affected) : null,
      );
      insertReq.input(
        "zones_affected",
        sql.NVarChar,
        body.zones_affected ? JSON.stringify(body.zones_affected) : null,
      );
      insertReq.input("detail", sql.NVarChar, JSON.stringify(body.detail));
      const inserted = await insertReq.query<{ alert_id: string; status: string }>(`
        INSERT INTO SuggestedAlerts (
          source, external_id, draft_text, category, severity,
          routes_affected, zones_affected, detail
        )
        OUTPUT INSERTED.alert_id, INSERTED.status
        VALUES (
          @source, @external_id, @draft_text, @category, @severity,
          @routes_affected, @zones_affected, @detail
        )
      `);
      const alert = inserted.recordset[0];
      await linkPreparedAlertToRisk(tx, body, alert.alert_id);
      await tx.commit();
      context.log(
        `OCC prepared suggested alert ${alert.alert_id} for ${body.source}:${body.external_id}`,
      );
      return {
        status: 201,
        jsonBody: { alert_id: alert.alert_id, status: alert.status, created: true },
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("POST /suggested-alerts/prepare failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("suggestedAlertsList", {
  route: "suggested-alerts",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, STAFF_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const status = request.query.get("status") || "pending";
      if (!["pending", "approved", "dismissed", "all"].includes(status)) {
        return { status: 400, jsonBody: { error: "status must be pending, approved, dismissed, or all" } };
      }
      const pool = await getPool();
      const sqlRequest = pool.request();
      let query = `
        SELECT TOP 100 alert_id, source, draft_text, category, severity,
               routes_affected, zones_affected, detail, status,
               created_at, reviewed_by, reviewed_at, message_id
        FROM SuggestedAlerts
      `;
      if (status !== "all") {
        query += ` WHERE status = @status`;
        sqlRequest.input("status", sql.NVarChar, status);
      }
      query += ` ORDER BY created_at DESC`;

      const result = await sqlRequest.query<SuggestedAlertRow>(query);
      const alerts = result.recordset.map((row) => ({
        ...row,
        routes_affected: row.routes_affected ? (JSON.parse(row.routes_affected) as string[]) : [],
        zones_affected: row.zones_affected ? (JSON.parse(row.zones_affected) as string[]) : [],
        detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
      }));
      return { status: 200, jsonBody: { alerts } };
    } catch (err) {
      context.error("GET /suggested-alerts failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("suggestedAlertsApprove", {
  route: "suggested-alerts/{id}/approve",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const id = request.params.id;
    if (!isGuid(id)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    const reviewedBy = authResult.principal.userDetails ?? "onboard-console";
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const readReq = new sql.Request(tx);
      readReq.input("id", sql.UniqueIdentifier, id);
      const alertResult = await readReq.query<SuggestedAlertRow>(`
        SELECT alert_id, source, draft_text, category, severity,
               routes_affected, zones_affected, detail, status,
               created_at, reviewed_by, reviewed_at, message_id
        FROM SuggestedAlerts WITH (UPDLOCK, ROWLOCK)
        WHERE alert_id = @id
      `);
      if (alertResult.recordset.length === 0) {
        await tx.rollback();
        return { status: 404, jsonBody: { error: "Suggested alert not found" } };
      }
      const alert = alertResult.recordset[0];
      if (alert.status !== "pending") {
        await tx.rollback();
        return { status: 409, jsonBody: { error: `Alert already ${alert.status}` } };
      }

      // Expiration from the category default (same rule as auto-inferred
      // message creation would use).
      const ttlReq = new sql.Request(tx);
      ttlReq.input("category", sql.NVarChar, alert.category);
      const ttlResult = await ttlReq.query<{ default_ttl_minutes: number }>(
        `SELECT default_ttl_minutes FROM ExpirationDefaults WHERE category = @category`,
      );
      const ttlMinutes = ttlResult.recordset[0]?.default_ttl_minutes ?? 240;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
      const summary = alert.draft_text.substring(0, 200);

      const insertReq = new sql.Request(tx);
      insertReq.input("raw_text", sql.NVarChar, alert.draft_text);
      insertReq.input("summary", sql.NVarChar, summary);
      insertReq.input("category", sql.NVarChar, alert.category);
      insertReq.input("severity", sql.NVarChar, alert.severity);
      insertReq.input("routes_affected", sql.NVarChar, alert.routes_affected);
      insertReq.input("zones_affected", sql.NVarChar, alert.zones_affected);
      insertReq.input("tags", sql.NVarChar, JSON.stringify(["suggested-alert", alert.source]));
      insertReq.input("created_by", sql.NVarChar, reviewedBy);
      insertReq.input("expires_at", sql.DateTime2, expiresAt);
      const inserted = await insertReq.query<{ message_id: string; created_at: Date; expires_at: Date }>(`
        INSERT INTO Messages (
          raw_text, summary, category, severity,
          routes_affected, zones_affected, tags,
          created_by, expires_at, expiration_source
        )
        OUTPUT INSERTED.message_id, INSERTED.created_at, INSERTED.expires_at
        VALUES (
          @raw_text, @summary, @category, @severity,
          @routes_affected, @zones_affected, @tags,
          @created_by, @expires_at, 'category_default'
        )
      `);
      const message = inserted.recordset[0];

      const updateReq = new sql.Request(tx);
      updateReq.input("id", sql.UniqueIdentifier, id);
      updateReq.input("reviewed_by", sql.NVarChar, reviewedBy);
      updateReq.input("message_id", sql.UniqueIdentifier, message.message_id);
      await updateReq.query(`
        UPDATE SuggestedAlerts
        SET status = 'approved', reviewed_by = @reviewed_by,
            reviewed_at = SYSUTCDATETIME(), message_id = @message_id
        WHERE alert_id = @id
      `);

      await tx.commit();

      // Same downstream path as a manual announcement (best-effort publish).
      await publishMessageCreated(
        {
          message_id: message.message_id,
          category: alert.category,
          severity: alert.severity,
          summary,
          routes_affected: alert.routes_affected ? (JSON.parse(alert.routes_affected) as string[]) : null,
          zones_affected: alert.zones_affected ? (JSON.parse(alert.zones_affected) as string[]) : null,
          channels: null,
          created_at: message.created_at,
          expires_at: message.expires_at,
        },
        context,
      );

      return {
        status: 200,
        jsonBody: { alert_id: id, status: "approved", message_id: message.message_id },
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("POST /suggested-alerts/{id}/approve failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("suggestedAlertsDismiss", {
  route: "suggested-alerts/{id}/dismiss",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, PUBLISH_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const id = request.params.id;
    if (!isGuid(id)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }
    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("id", sql.UniqueIdentifier, id);
      sqlRequest.input("reviewed_by", sql.NVarChar, authResult.principal.userDetails ?? "onboard-console");
      const result = await sqlRequest.query<{ alert_id: string; status: string }>(`
        UPDATE SuggestedAlerts
        SET status = 'dismissed', reviewed_by = @reviewed_by, reviewed_at = SYSUTCDATETIME()
        OUTPUT INSERTED.alert_id, INSERTED.status
        WHERE alert_id = @id AND status = 'pending'
      `);
      if (result.recordset.length === 0) {
        return { status: 404, jsonBody: { error: "Pending suggested alert not found" } };
      }
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /suggested-alerts/{id}/dismiss failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
