// Operator upload of a GTFS-Flex archive, for the case the daily poller cannot
// serve.
//
// No published GTFS-Flex URL exists for MVTA Connect, so ON_DEMAND_ZONE_FLEX_URL
// is unset and onDemandZonesSync skips every run. The archive is downloaded by
// hand from Spare when it changes. Until now the only way to get those bytes
// into the database was scripts/importOnDemandZones.ts, which needs
// SQL_CONNECTION_STRING and therefore an SSH session into the REST container
// with the archive base64-pasted into /tmp - a path nobody has ever executed,
// for a file that has to be re-seeded every time the service area moves.
//
// This is the same import, reached the way the file actually arrives. It shares
// every code path with the poller and the script - same parser, same hash, same
// transactional write, same first-import activation rule - so a version
// uploaded this way is indistinguishable from a polled one, and re-uploading
// identical bytes is recognised as already imported rather than duplicated.
// Prefer the poller the moment a URL exists; this does not replace it.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool } from "../lib/db";
import { loadOperationalZonesFromGtfsFlexArchive } from "../lib/onDemandOperationalZones";
import { importOperationalZoneVersion, sourceSha256 } from "../lib/onDemandZoneImport";

// A GTFS-Flex archive carrying two pilot zones is tens of kilobytes. The cap is
// generous for growth and still far below anything that would trouble the B1
// worker, which is read whole into memory before it is parsed.
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

export type ArchiveRejection = { status: 400 | 413; error: string };

// Size and emptiness are judged before the archive is parsed, so an accidental
// upload of the wrong thing is refused on its shape rather than by AdmZip
// throwing partway through a multi-megabyte read.
export function rejectArchive(byteLength: number): ArchiveRejection | null {
  if (byteLength === 0) return { status: 400, error: "No archive was uploaded." };
  if (byteLength > MAX_ARCHIVE_BYTES) {
    return {
      status: 413,
      error: `That archive is larger than the ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MB limit for a GTFS-Flex feed.`,
    };
  }
  return null;
}

// The three outcomes of an import, said in the operator's terms. "Already
// imported" is deliberately not phrased as success: identical bytes may be
// sitting under an inactive version, and treating that as done is how a
// re-seeded feed silently fails to take effect.
export function importOutcomeMessage(result: { imported: boolean; activated: boolean }): string {
  if (!result.imported) {
    return "These exact bytes are already stored under this feed version; nothing changed. Check whether that version is the active one.";
  }
  return result.activated
    ? "Imported and activated. The on-demand zone monitor now has geometry."
    : "Imported as inactive, because another version is already active. Activate it when the change is intended.";
}

app.http("onDemandZoneUpload", {
  route: "on-demand-zone-versions/upload",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    let archive: Buffer;
    try {
      archive = Buffer.from(await request.arrayBuffer());
    } catch {
      return { status: 400, jsonBody: { error: "Could not read the uploaded archive." } };
    }
    const rejection = rejectArchive(archive.byteLength);
    if (rejection) return { status: rejection.status, jsonBody: { error: rejection.error } };

    // Parsed before the database is touched, exactly as the script does it: a
    // malformed archive, or one missing an expected zone, is refused here
    // rather than after a transaction is open. The parser's messages name the
    // missing file or zone and carry no rider data, so they are returned to the
    // operator instead of a generic failure they cannot act on.
    let snapshot;
    try {
      snapshot = loadOperationalZonesFromGtfsFlexArchive(archive);
    } catch (err) {
      context.warn("Rejected an uploaded GTFS-Flex archive:", err);
      return {
        status: 400,
        jsonBody: {
          error: err instanceof Error ? err.message : "That file is not a readable GTFS-Flex archive.",
          hint: "MVTA's fixed-route google_transit.zip is not this feed; the archive needs locations.geojson and a feed_info.txt carrying feed_version.",
        },
      };
    }

    try {
      const actor = auth.principal.userDetails || "unknown";
      const result = await importOperationalZoneVersion(
        await getPool(),
        snapshot,
        sourceSha256(archive),
        `upload:${actor}`,
      );
      return {
        status: 200,
        jsonBody: {
          ...result,
          zones: snapshot.zones.map((zone) => zone.name),
          message: importOutcomeMessage(result),
        },
      };
    } catch (err) {
      context.error("POST /on-demand-zone-versions/upload failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
