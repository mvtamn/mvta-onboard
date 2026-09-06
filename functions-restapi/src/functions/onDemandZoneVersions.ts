// Review and activation for imported on-demand operational zone versions.
//
// onDemandZonesSync imports geometry but does not put it into force, except for
// the very first version where there is nothing to put out of force. Everything
// after that is a deliberate act: activating swaps the boundaries a live
// monitor resolves pickups against, which changes which requests are judged
// in-zone. That is an Operations decision, so it is an admin-gated call rather
// than a timer's side effect.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { ADMIN_ROLES, requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { activateOperationalZoneVersion, activationAuditSupported } from "../lib/onDemandZoneImport";
import { isGuid } from "../lib/validation";

app.http("onDemandZoneVersions", {
  route: "on-demand-zone-versions",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, request.method === "GET" ? STAFF_READ_ROLES : ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (request.method === "GET") {
        // Migration 097's attribution columns are selected only once they
        // exist, so this listing answers on a database the migration has not
        // reached yet rather than failing on an unknown column.
        const attribution = await activationAuditSupported(pool)
          ? "v.activated_by, v.activated_at,"
          : "CAST(NULL AS NVARCHAR(200)) AS activated_by, CAST(NULL AS DATETIME2) AS activated_at,";
        const versions = await pool.request().query(`
          SELECT v.id, v.feed_version, v.source_sha256, v.is_active, v.imported_at, v.imported_by,
            ${attribution}
            (SELECT COUNT(*) FROM dbo.OnDemandOperationalZones z WHERE z.zone_version_id = v.id) AS zone_count
          FROM dbo.OnDemandOperationalZoneVersions v
          ORDER BY v.imported_at DESC
        `);
        return { status: 200, jsonBody: { versions: versions.recordset } };
      }

      let body: Record<string, unknown> | null;
      try { body = await request.json() as Record<string, unknown>; } catch { body = null; }
      const versionId = typeof body?.version_id === "string" ? body.version_id : "";
      if (!isGuid(versionId)) {
        return { status: 400, jsonBody: { error: "version_id must be a version identifier" } };
      }

      const actor = auth.principal.userDetails || "unknown";
      const result = await activateOperationalZoneVersion(pool, versionId, actor);
      if (result.kind === "not_found") {
        return { status: 404, jsonBody: { error: "Zone version not found" } };
      }
      if (result.kind === "already_active") {
        return { status: 200, jsonBody: { activated: false, message: "That zone version is already active." } };
      }
      if (result.kind === "no_zones") {
        return {
          status: 409,
          jsonBody: { error: "That zone version has no zones; activating it would leave the monitor without geometry." },
        };
      }
      context.log(
        `On-demand zone version ${versionId} (feed version ${result.feedVersion}, ${result.zoneCount} zones) ` +
          `activated by ${actor}.`,
      );
      return {
        status: 200,
        jsonBody: { activated: true, feed_version: result.feedVersion, zone_count: result.zoneCount },
      };
    } catch (err) {
      context.error("on-demand-zone-versions request failed:", err);
      return { status: 500, jsonBody: { error: "Failed to read or update on-demand zone versions" } };
    }
  },
});
