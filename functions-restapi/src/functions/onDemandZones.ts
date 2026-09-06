// Operational-zone version administration for the on-demand monitor.
//
// GTFS-Flex zone geometry changes once or twice a year and no published feed
// URL exists for it, so the archive arrives as an operator upload rather than
// through a poller. The import core (lib/onDemandZoneImport) takes bytes, so
// a timer-triggered fetch can be added on top of it unchanged if MVTA or
// Spare ever publishes one.
//
// Routes live under manage/, not admin/: the Functions runtime reserves the
// admin/ prefix for itself and silently refuses to register anything beneath
// it (#178).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { getPool } from "../lib/db";
import { invalidateActiveOperationalZonesCache } from "../lib/onDemandSpareMonitorStore";
import {
  activateOperationalZoneVersion,
  listOperationalZoneVersions,
  MAX_ZONE_ARCHIVE_BYTES,
  type ParsedZoneArchive,
  parseOperationalZoneArchive,
  storeOperationalZoneSnapshot,
} from "../lib/onDemandZoneImport";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.http("onDemandZoneVersionsList", {
  route: "manage/on-demand-zones",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const versions = await listOperationalZoneVersions(await getPool());
      return {
        status: 200,
        jsonBody: {
          versions,
          // The state the on-demand monitor actually reads. Said plainly here
          // because "no versions" and "versions, none active" fail the same
          // way downstream and are fixed differently.
          active_version_id: versions.find((version) => version.is_active)?.version_id ?? null,
        },
      };
    } catch (err) {
      context.error("GET /manage/on-demand-zones failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("onDemandZoneVersionImport", {
  route: "manage/on-demand-zones/import",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    let archive: Buffer;
    try {
      archive = Buffer.from(await request.arrayBuffer());
    } catch {
      return { status: 400, jsonBody: { error: "The request body could not be read as a GTFS-Flex archive." } };
    }
    if (archive.byteLength > MAX_ZONE_ARCHIVE_BYTES) {
      return {
        status: 413,
        jsonBody: { error: `The GTFS-Flex archive exceeds the ${MAX_ZONE_ARCHIVE_BYTES}-byte limit.` },
      };
    }

    // Parsed before the pool is opened, so only the upload itself can produce
    // a 400. A database that is down is not a bad archive, and answering it
    // with one sends the operator to re-export a feed that was fine.
    let parsed: ParsedZoneArchive;
    try {
      parsed = parseOperationalZoneArchive(archive);
    } catch (err) {
      // The parser's messages name what is wrong with the feed - a missing
      // locations.geojson, invalid geometry, a duplicate or missing expected
      // zone - and are the whole value of a 400 here. Nothing operator-
      // supplied is echoed back beyond that.
      const message = err instanceof Error ? err.message : "The GTFS-Flex archive could not be read.";
      context.warn(`Rejected an on-demand zone import: ${message}`);
      return { status: 400, jsonBody: { error: message } };
    }

    try {
      const result = await storeOperationalZoneSnapshot(
        await getPool(),
        parsed,
        auth.principal.userDetails ?? "onboard-console",
      );
      context.log(
        `On-demand zone import: feed version ${result.feed_version}, ${result.zone_count} zone(s), ` +
          `${result.already_imported ? "already imported" : "imported"} by ${result.imported_by}.`,
      );
      // An import is never active. Nothing changes for the monitor until
      // someone activates this version, which is the point of the split.
      return { status: result.already_imported ? 200 : 201, jsonBody: result };
    } catch (err) {
      context.error("POST /manage/on-demand-zones/import failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("onDemandZoneVersionActivate", {
  route: "manage/on-demand-zones/{versionId}/activate",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const versionId = request.params.versionId?.trim();
    if (!versionId || !GUID.test(versionId)) {
      return { status: 400, jsonBody: { error: "versionId must be a GUID." } };
    }
    try {
      const result = await activateOperationalZoneVersion(await getPool(), versionId);
      if (result.kind === "not_found") {
        return { status: 404, jsonBody: { error: "No operational zone version was found with that id." } };
      }
      if (result.kind === "empty_version") {
        return {
          status: 409,
          jsonBody: {
            error: "That version contains no zones; activating it would leave the on-demand monitor without geometry.",
          },
        };
      }
      invalidateActiveOperationalZonesCache();
      context.log(
        `On-demand zone version ${versionId} (feed version ${result.version.feed_version}, ` +
          `${result.version.zone_count} zone(s)) activated by ${auth.principal.userDetails ?? "unknown"}.`,
      );
      return { status: 200, jsonBody: result.version };
    } catch (err) {
      context.error("POST /manage/on-demand-zones/{versionId}/activate failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
