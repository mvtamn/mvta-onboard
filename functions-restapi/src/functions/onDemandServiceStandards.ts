import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ADMIN_ROLES, requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { isGuid, validateOnDemandServiceStandard, validateOnDemandZoneServiceStandardOverride } from "../lib/validation";

const policyColumns = "default_minutes, updated_by, updated_at";

async function bodyOf(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

app.http("onDemandServiceStandards", {
  route: "on-demand-service-standards",
  methods: ["GET", "PATCH"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, request.method === "GET" ? STAFF_READ_ROLES : ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        const policy = await pool.request().query(`SELECT ${policyColumns} FROM dbo.OnDemandServiceStandardPolicy WHERE id = 1`);
        if (!policy.recordset[0]) return { status: 503, jsonBody: { error: "Service-standard policy is not ready - apply migration-075." } };
        const zones = await pool.request().query(`
          SELECT z.id AS zone_id, z.external_location_id, z.name,
            o.minutes, o.reason, o.effective_at, o.expires_at,
            CASE WHEN o.revoked_at IS NULL AND o.effective_at <= SYSUTCDATETIME() AND SYSUTCDATETIME() < o.expires_at THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS override_active
          FROM dbo.OnDemandOperationalZones z
          JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1
          LEFT JOIN dbo.OnDemandZoneServiceStandardOverrides o ON o.external_location_id = z.external_location_id AND o.revoked_at IS NULL
          ORDER BY z.name
        `);
        return { status: 200, jsonBody: { ...policy.recordset[0], zones: zones.recordset } };
      }
      const body = await bodyOf(request);
      if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
      const errors = validateOnDemandServiceStandard(body);
      if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
      const requestDb = pool.request();
      requestDb.input("minutes", sql.Int, body.minutes as number);
      requestDb.input("actor", sql.NVarChar(320), auth.principal.userDetails || "system");
      const result = await requestDb.query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @previous_minutes INT = (SELECT default_minutes FROM dbo.OnDemandServiceStandardPolicy WHERE id = 1);
        UPDATE dbo.OnDemandServiceStandardPolicy SET default_minutes = @minutes, updated_by = @actor, updated_at = SYSUTCDATETIME() WHERE id = 1;
        INSERT INTO dbo.OnDemandServiceStandardAudit (action, detail_json, occurred_by)
          VALUES ('default_updated', (SELECT @previous_minutes AS previous_minutes, @minutes AS default_minutes FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), @actor);
        COMMIT;
        SELECT ${policyColumns} FROM dbo.OnDemandServiceStandardPolicy WHERE id = 1;
      `);
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error(`${request.method} /on-demand-service-standards failed:`, err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("onDemandZoneServiceStandard", {
  route: "on-demand-service-standards/zones/{zoneId}",
  methods: ["PUT", "DELETE"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const zoneId = request.params.zoneId;
    if (!isGuid(zoneId)) return { status: 400, jsonBody: { error: "zoneId must be a GUID" } };
    try {
      const pool = await getPool();
      const requestDb = pool.request();
      requestDb.input("zone_id", sql.UniqueIdentifier, zoneId);
      requestDb.input("actor", sql.NVarChar(320), auth.principal.userDetails || "system");
      if (request.method === "DELETE") {
        const result = await requestDb.query(`
          SET XACT_ABORT ON;
          BEGIN TRANSACTION;
          DECLARE @override_id UNIQUEIDENTIFIER = (SELECT id FROM dbo.OnDemandZoneServiceStandardOverrides o JOIN dbo.OnDemandOperationalZones z ON z.external_location_id = o.external_location_id JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1 WHERE z.id = @zone_id AND o.revoked_at IS NULL);
          IF @override_id IS NULL BEGIN ROLLBACK; SELECT CAST(0 AS bit) AS removed; RETURN; END;
          UPDATE dbo.OnDemandZoneServiceStandardOverrides SET revoked_at = SYSUTCDATETIME(), revoked_by = @actor WHERE id = @override_id;
          INSERT INTO dbo.OnDemandServiceStandardAudit (action, zone_override_id, detail_json, occurred_by)
            VALUES ('override_removed', @override_id, (SELECT external_location_id, minutes, reason, effective_at, expires_at FOR JSON PATH, WITHOUT_ARRAY_WRAPPER FROM dbo.OnDemandZoneServiceStandardOverrides WHERE id = @override_id), @actor);
          COMMIT; SELECT CAST(1 AS bit) AS removed;
        `);
        return result.recordset[0]?.removed ? { status: 204 } : { status: 404, jsonBody: { error: "Zone override not found" } };
      }
      const body = await bodyOf(request);
      if (!body) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
      const errors = validateOnDemandZoneServiceStandardOverride(body);
      if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
      requestDb.input("minutes", sql.Int, body.minutes as number);
      requestDb.input("reason", sql.NVarChar(500), (body.reason as string).trim());
      requestDb.input("effective_at", sql.DateTime2, new Date(body.effective_at as string));
      requestDb.input("expires_at", sql.DateTime2, new Date(body.expires_at as string));
      const result = await requestDb.query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @external_location_id NVARCHAR(200) = (SELECT z.external_location_id FROM dbo.OnDemandOperationalZones z JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1 WHERE z.id = @zone_id);
        IF @external_location_id IS NULL BEGIN ROLLBACK; SELECT CAST(0 AS bit) AS zone_found; RETURN; END;
        DECLARE @override_id UNIQUEIDENTIFIER = (SELECT id FROM dbo.OnDemandZoneServiceStandardOverrides WHERE external_location_id = @external_location_id AND revoked_at IS NULL);
        DECLARE @action NVARCHAR(30) = CASE WHEN @override_id IS NULL THEN 'override_created' ELSE 'override_updated' END;
        IF @override_id IS NULL
          BEGIN
            DECLARE @inserted TABLE (id UNIQUEIDENTIFIER);
            INSERT INTO dbo.OnDemandZoneServiceStandardOverrides (external_location_id, minutes, reason, effective_at, expires_at, created_by)
              OUTPUT INSERTED.id INTO @inserted
              VALUES (@external_location_id, @minutes, @reason, @effective_at, @expires_at, @actor);
            SET @override_id = (SELECT id FROM @inserted);
          END
        ELSE UPDATE dbo.OnDemandZoneServiceStandardOverrides SET minutes = @minutes, reason = @reason, effective_at = @effective_at, expires_at = @expires_at, updated_by = @actor, updated_at = SYSUTCDATETIME() WHERE id = @override_id;
        INSERT INTO dbo.OnDemandServiceStandardAudit (action, zone_override_id, detail_json, occurred_by) VALUES (@action, @override_id, (SELECT @external_location_id AS external_location_id, @minutes AS minutes, @reason AS reason, @effective_at AS effective_at, @expires_at AS expires_at FOR JSON PATH, WITHOUT_ARRAY_WRAPPER), @actor);
        COMMIT;
        SELECT CAST(1 AS bit) AS zone_found, id, minutes, reason, effective_at, expires_at FROM dbo.OnDemandZoneServiceStandardOverrides WHERE id = @override_id;
      `);
      if (!result.recordset[0]?.zone_found) return { status: 404, jsonBody: { error: "Operational zone not found" } };
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error(`${request.method} /on-demand-service-standards/zones failed:`, err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("onDemandServiceStandardAudit", {
  route: "on-demand-service-standards/audit",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const result = await (await getPool()).request().query(`SELECT TOP 100 action, zone_override_id, detail_json, occurred_by, occurred_at FROM dbo.OnDemandServiceStandardAudit ORDER BY occurred_at DESC`);
      return { status: 200, jsonBody: { audit: result.recordset } };
    } catch (err) {
      context.error("GET /on-demand-service-standards/audit failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
