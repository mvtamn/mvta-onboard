// GET /detours - list detour/closure records with a computed status
// (Active/Upcoming/Monitor/Recently finished/Expired - see detourStatus.ts,
// the single shared definition). Any staff role can read, including
// OCC.Viewer (read-only per the owner's decision - Detours is a day-to-day
// operational view, not compliance-audit or admin-only), plus OCC.Compliance
// (which needs detour history for reporting but no edit rights) and the
// dedicated OCC.Detour role - see DETOUR_READ_ROLES in auth.ts. Accepts an
// optional ?status= filter using the same status keys DETOUR_STATUS_LABELS
// exposes; an unrecognized value is ignored rather than erroring, so a
// stale/typo'd query param degrades to "show everything" instead of 400ing.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, DETOUR_READ_ROLES } from "../lib/auth";
import { computeDetourStatus, toDateOnly, toTimeOnly, type DetourStatus } from "../lib/detourStatus";
import { computeDetourReadiness } from "../lib/detourReadiness";
import { contractorFromSettings, requiredAudiences, type ContractorNotification } from "../lib/detourContractor";

interface DetourRow {
  id: string;
  number: string | null;
  closure: string;
  // The mssql driver returns a JS Date for a DATE column, NOT a string -
  // typed honestly here so the normalization below can't be dropped by
  // someone reading this interface and assuming it's already a string.
  start_date: Date | string | null;
  end_date: Date | string | null;
  is_monitor_only: boolean;
  riders_directed: string | null;
  email_sent: boolean;
  expired_email_sent: boolean;
  spare_emailed: boolean;
  source: "manual" | "avail";
  external_detour_id: string | null;
  last_edited_manually: boolean;
  avail_last_seen_at: Date | null;
  // Absent (not null) on rows read before migration-024 has run.
  internal_number?: string | null;
  // Reporting fields (Part B6) - likewise absent, not null, until
  // migration-025 has run.
  reason_code?: string | null;
  severity?: "minor" | "moderate" | "major" | null;
  reported_by?: string | null;
  reported_at?: Date | null;
  approved_by?: string | null;
  approved_at?: Date | null;
  radio_notified?: boolean;
  dispatch_board_notified?: boolean;
  social_media_notified?: boolean;
  resolution_notes?: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  fulfillment_mode?: "avail" | "fixed_route_manual" | "mobility_manual";
  lifecycle_state?: string;
  workflow_owner?: string | null;
  workflow_updated_by?: string | null;
  workflow_updated_at?: Date | null;
  avail_build_confirmed_at?: Date | null;
  avail_entry_result?: "entered" | "conflict" | "not_entered" | null;
  avail_entry_confirmed_by?: string | null;
  avail_entry_confirmed_at?: Date | null;
  notification_audiences?: string | null;
  notification_channels?: string | null;
  action_instructions?: string | null;
  service_impact?: "fixed_route" | "mobility" | null;
  service_area?: string | null;
  evidence_notes?: string | null;
  evidence_reference?: string | null;
  start_time?: Date | string | null;
  end_time?: Date | string | null;
  time_window_status?: "pending" | "estimated" | "confirmed" | null;
  affected_stops_and_stations?: string | null;
  operational_impacts?: string | null;
  confirmation_contact?: string | null;
  location?: string | null;
  communications_published?: number;
  communications_draft?: number;
  review_status?: "current" | "needs_review";
  review_reason?: string | null;
  closure_reason?: string | null;
}

interface SegmentRow {
  id: string;
  detour_id: string;
  routes: string;
  directions: string | null;
  sort_order: number;
}

const VALID_STATUSES: DetourStatus[] = ["monitor", "upcoming", "active", "recently_finished", "expired"];

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

app.http("detoursList", {
  route: "detours",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const statusParam = request.query.get("status");
    const statusFilter = VALID_STATUSES.includes(statusParam as DetourStatus)
      ? (statusParam as DetourStatus)
      : null;
    const operationsView = request.query.get("view") === "operations";

    try {
      const pool = await getPool();

      // internal_number (Part B10, migration-024) is selected only once the
      // column exists - SQL Server parses the whole batch up front, so naming
      // a missing column fails even inside a CASE. Pre-migration the field
      // comes back undefined and the console falls back to hiding it, same
      // graceful-degradation pattern as every other un-run migration here.
      const schemaCheck = await pool.request().query<{ has_column: number; reporting_ready: number; workflow_ready: number; avail_entry_ready: number; operational_fields: number; intake_fields: number; location_field: number; window_fields: number; communications_ready: number; review_ready: number }>(`
        SELECT
          CASE WHEN COL_LENGTH('dbo.Detours', 'internal_number') IS NULL
               THEN 0 ELSE 1 END AS has_column,
          CASE WHEN COL_LENGTH('dbo.Detours', 'reason_code') IS NULL
               THEN 0 ELSE 1 END AS reporting_ready,
          CASE WHEN COL_LENGTH('dbo.Detours', 'fulfillment_mode') IS NULL
                    OR COL_LENGTH('dbo.Detours', 'lifecycle_state') IS NULL
               THEN 0 ELSE 1 END AS workflow_ready,
          CASE WHEN COL_LENGTH('dbo.Detours', 'avail_entry_result') IS NULL
                    OR COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_by') IS NULL
                    OR COL_LENGTH('dbo.Detours', 'avail_entry_confirmed_at') IS NULL
               THEN 0 ELSE 1 END AS avail_entry_ready
          ,CASE WHEN COL_LENGTH('dbo.Detours', 'notification_audiences') IS NULL THEN 0 ELSE 1 END AS operational_fields
          ,CASE WHEN COL_LENGTH('dbo.Detours', 'service_impact') IS NULL
                     OR COL_LENGTH('dbo.Detours', 'evidence_reference') IS NULL
                THEN 0 ELSE 1 END AS intake_fields
          ,CASE WHEN COL_LENGTH('dbo.Detours', 'location') IS NULL THEN 0 ELSE 1 END AS location_field
          ,CASE WHEN COL_LENGTH('dbo.Detours', 'start_time') IS NULL
                     OR COL_LENGTH('dbo.Detours', 'confirmation_contact') IS NULL
                THEN 0 ELSE 1 END AS window_fields
          ,CASE WHEN OBJECT_ID('dbo.DetourCommunications', 'U') IS NULL THEN 0 ELSE 1 END AS communications_ready
          ,CASE WHEN COL_LENGTH('dbo.Detours', 'review_status') IS NULL THEN 0 ELSE 1 END AS review_ready
      `);
      const hasInternalNumber = schemaCheck.recordset[0]?.has_column === 1;
      const hasReportingFields = schemaCheck.recordset[0]?.reporting_ready === 1;
      const hasWorkflowFields = schemaCheck.recordset[0]?.workflow_ready === 1;
      const hasAvailEntryFields = schemaCheck.recordset[0]?.avail_entry_ready === 1;
      const hasOperationalFields = schemaCheck.recordset[0]?.operational_fields === 1;
      // Migration 057 (service impact/area, action instructions, evidence)
      // and migration 069 (operating window times, affected stops, impacts,
      // contact). Promotion writes all of these; without selecting them
      // here the intake record is write-only once accepted.
      const hasIntakeFields = schemaCheck.recordset[0]?.intake_fields === 1;
      const hasWindowFields = schemaCheck.recordset[0]?.window_fields === 1;
      const hasLocation = schemaCheck.recordset[0]?.location_field === 1; // migration 088
      const hasCommunications = schemaCheck.recordset[0]?.communications_ready === 1;
      const hasReviewFields = schemaCheck.recordset[0]?.review_ready === 1;

      const REPORTING_COLUMNS = `
        reason_code, severity, reported_by, reported_at, approved_by, approved_at,
        radio_notified, dispatch_board_notified, social_media_notified, resolution_notes`;

      // Contractor notification settings (migration 089). Absent table or
      // rows means no contractor is configured, which changes nothing.
      let contractor: ContractorNotification = { name: null, recipients: [] };
      try {
        const settings = await pool.request().query<{ setting_key: string; setting_value: string }>(
          "SELECT setting_key, setting_value FROM AppSettings WHERE module = 'detour' AND setting_key IN ('contractor_name', 'contractor_recipients')",
        );
        contractor = contractorFromSettings(settings.recordset);
      } catch { /* AppSettings not present in this environment */ }

      const detoursResult = await pool.request().query<DetourRow>(`
        SELECT id, number, closure, start_date, end_date, is_monitor_only, riders_directed,
               email_sent, expired_email_sent, spare_emailed, source, external_detour_id,
               last_edited_manually, avail_last_seen_at, created_by, created_at, updated_by, updated_at
               ${hasInternalNumber ? ", internal_number" : ""}
               ${hasReportingFields ? `, ${REPORTING_COLUMNS}` : ""}
               ${hasWorkflowFields ? ", fulfillment_mode, lifecycle_state, workflow_owner, workflow_updated_by, workflow_updated_at, avail_build_confirmed_at" : ""}
               ${hasAvailEntryFields ? ", avail_entry_result, avail_entry_confirmed_by, avail_entry_confirmed_at" : ""}
               ${hasOperationalFields ? ", notification_audiences, notification_channels, action_instructions" : ""}
               ${hasIntakeFields ? ", service_impact, service_area, evidence_notes, evidence_reference" : ""}
               ${hasWindowFields ? ", start_time, end_time, time_window_status, affected_stops_and_stations, operational_impacts, confirmation_contact" : ""}
               ${hasLocation ? ", location" : ""}
               ${hasCommunications ? ", (SELECT COUNT(DISTINCT c.audience) FROM DetourCommunications c WHERE c.detour_id=Detours.id AND c.status='published') AS communications_published, (SELECT COUNT(*) FROM DetourCommunications c WHERE c.detour_id=Detours.id AND c.status='draft') AS communications_draft" : ""}
               ${hasReviewFields ? ", review_status, review_reason, closure_reason" : ""}
        FROM Detours
        WHERE is_deleted = 0
        ORDER BY start_date DESC, created_at DESC
      `);
      const detours = detoursResult.recordset;

      const segmentsResult = await pool.request().query<SegmentRow>(`
        SELECT s.id, s.detour_id, s.routes, s.directions, s.sort_order
        FROM DetourSegments s
        JOIN Detours d ON d.id = s.detour_id
        WHERE d.is_deleted = 0
        ORDER BY s.detour_id, s.sort_order
      `);
      const segmentsByDetour = new Map<string, SegmentRow[]>();
      for (const seg of segmentsResult.recordset) {
        const list = segmentsByDetour.get(seg.detour_id) ?? [];
        list.push(seg);
        segmentsByDetour.set(seg.detour_id, list);
      }

      // start_date/end_date are emitted as plain YYYY-MM-DD, not as the
      // driver's Date objects (which JSON-serialize to a full ISO
      // timestamp). Every consumer treats a detour date as a service day:
      // the console renders it, feeds it straight into <input type="date">
      // on the edit form, and range-filters on it - and an ISO timestamp
      // breaks all three (a date input silently rejects the value and
      // renders BLANK, so saving an edit would have wiped the dates).
      const withStatus = detours.map((d) => ({
        ...d,
        start_date: toDateOnly(d.start_date),
        end_date: toDateOnly(d.end_date),
        status: computeDetourStatus(d),
        ...(hasWorkflowFields ? { fulfillment_mode: d.fulfillment_mode, lifecycle_state: d.lifecycle_state, workflow_owner: d.workflow_owner, workflow_updated_by: d.workflow_updated_by, workflow_updated_at: d.workflow_updated_at, avail_build_confirmed_at: d.avail_build_confirmed_at } : {}),
        ...(hasAvailEntryFields ? { avail_entry_result: d.avail_entry_result, avail_entry_confirmed_by: d.avail_entry_confirmed_by, avail_entry_confirmed_at: d.avail_entry_confirmed_at } : {}),
        ...(hasOperationalFields ? { notification_audiences: parseList(d.notification_audiences), notification_channels: parseList(d.notification_channels), action_instructions: d.action_instructions ?? null } : {}),
        ...(hasIntakeFields ? { service_impact: d.service_impact ?? null, service_area: d.service_area ?? null, evidence_notes: d.evidence_notes ?? null, evidence_reference: d.evidence_reference ?? null } : {}),
        // Times reduce to HH:MM the same way the dates reduce to YYYY-MM-DD:
        // the driver's 1970-pinned Date would otherwise serialize as a full
        // ISO timestamp nobody can read as a time of day.
        ...(hasLocation ? { location: d.location ?? null } : {}),
        ...(hasWindowFields ? { start_time: toTimeOnly(d.start_time), end_time: toTimeOnly(d.end_time), time_window_status: d.time_window_status ?? null, affected_stops_and_stations: d.affected_stops_and_stations ?? null, operational_impacts: d.operational_impacts ?? null, confirmation_contact: d.confirmation_contact ?? null } : {}),
        ...(hasOperationalFields || contractor.name ? {
          required_audiences: requiredAudiences({ notification_audiences: parseList(d.notification_audiences), service_impact: d.service_impact ?? null }, contractor),
        } : {}),
        ...(hasCommunications ? (() => {
          const required = requiredAudiences({ notification_audiences: parseList(d.notification_audiences), service_impact: d.service_impact ?? null }, contractor);
          return {
            communications_published: d.communications_published ?? 0,
            communications_draft: d.communications_draft ?? 0,
            communication_status: (d.communications_published ?? 0) >= required.length && required.length > 0 ? "published" : (d.communications_draft ?? 0) > 0 ? "draft" : "needs_communication",
          };
        })() : {}),
        ...(hasReviewFields ? { review_status: d.review_status, review_reason: d.review_reason, closure_reason: d.closure_reason } : {}),
        readiness: hasWorkflowFields ? computeDetourReadiness(d.fulfillment_mode, d.lifecycle_state as any) : undefined,
        segments: segmentsByDetour.get(d.id) ?? [],
      }));

      const filtered = statusFilter ? withStatus.filter((d) => d.status === statusFilter) : operationsView ? withStatus.filter((d) => d.status === "active" || d.status === "upcoming") : withStatus;

      const operationsReport = filtered.map((d) => ({
        id: d.id, reference: d.internal_number ?? d.number ?? d.id, closure: d.closure,
        affected_service: d.segments.map((s) => s.routes).join(", ") || "Service details not entered",
        action_instructions: d.action_instructions || d.riders_directed || "Follow the detour instructions in the record",
        effective_dates: `${d.start_date ?? "Open"} – ${d.end_date ?? "Open"}`,
        readiness: d.readiness, communication_status: (d as any).communication_status ?? "not_available",
        source: d.source === "avail" ? "Avail/feed observation" : "OnBoard intake",
        fulfillment_mode: d.fulfillment_mode ?? null, status: d.status,
        technical: { external_detour_id: d.external_detour_id, lifecycle_state: d.lifecycle_state, avail_entry_result: d.avail_entry_result },
      }));
      return { status: 200, jsonBody: { detours: filtered, contractor_notification: contractor, ...(operationsView ? { report: operationsReport } : {}) } };
    } catch (err) {
      context.error("GET /detours failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
