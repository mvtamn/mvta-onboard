// Avail360 AVL Reports - Avail's own proprietary vehicle-location API
// (https://avail360-api.myavail.cloud/AVLReports/v1/{Property}/{date}),
// distinct from the GTFS-Realtime feeds already ingested elsewhere in this
// repo (gtfsRealtime.ts, gtfsTripUpdates.ts, gtfsVehiclePositions.ts). Keyed
// by Avail's own numeric Vehicle/Block/Run/Trip IDs - no guaranteed join to
// a GTFS trip_id, so this is handled as a fully separate data source.
//
// CONFIRMED live 2026-08-05 (see otp-compliance-live-data-rethink.md): this
// request 404'd on every single run since deployment (1800+ consecutive
// failures). Root cause per OTP-Feed-Evaluation-and-Recommendation (3).md's
// own spec for this feed - GET /{Property}/{Start DateTime}/{End DateTime}
// - three segments: Property, then two full datetime segments (format
// "YYYY-MM-DD HH:MI:SS"), not the single date-only segment this originally
// sent.
//
// Property handling (updated 2026-08-06): AVAIL_AVL_REPORTS_URL may be
// configured either WITH or WITHOUT a trailing "/MVTA" - normalizeBaseUrl()
// below strips it if present, then PROPERTY is always appended exactly
// once, so the two conventions can never double up into ".../MVTA/MVTA/...".
// This matches every other Avail feed in this app, which bakes Property
// into its own base URL setting.
import { agencyLocalDateTimeToUtc } from "./missedTripTime";

export interface AvailAvlReport {
  Vehicle: number;
  Timestamp: string;
  Route: number | null;
  Block: number | null;
  Run: number | null;
  Trip: number | null;
  Latitude: number;
  Longitude: number;
  Heading: number | null;
  Direction: string | null;
}

export interface MappedAvlVehicle {
  vehicle_id: number;
  route: number | null;
  block: number | null;
  run: number | null;
  trip: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  report_timestamp: Date;
}

// Avail returns live Timestamp values as agency-local wall-clock ISO strings
// without a zone suffix. Node runs in UTC in Azure, so new Date(value) alone
// makes a current CDT report appear five hours old (six in CST). Preserve
// explicitly zoned values, but interpret zone-less values in America/Chicago.
function parseAvailTimestamp(value: string): Date | null {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const zoned = new Date(value);
    return Number.isNaN(zoned.getTime()) ? null : zoned;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!match) return null;
  const timestamp = agencyLocalDateTimeToUtc({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  });
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapVehiclePositionEntity/mapAlertEntity
// elsewhere in this repo).
export function mapAvlReport(report: AvailAvlReport): MappedAvlVehicle | null {
  if (
    typeof report.Vehicle !== "number" ||
    typeof report.Latitude !== "number" ||
    typeof report.Longitude !== "number"
  ) {
    return null;
  }
  const timestamp = parseAvailTimestamp(report.Timestamp);
  if (!timestamp) return null;

  return {
    vehicle_id: report.Vehicle,
    route: report.Route ?? null,
    block: report.Block ?? null,
    run: report.Run ?? null,
    trip: report.Trip ?? null,
    latitude: report.Latitude,
    longitude: report.Longitude,
    heading: report.Heading ?? null,
    direction: report.Direction ?? null,
    report_timestamp: timestamp,
  };
}
