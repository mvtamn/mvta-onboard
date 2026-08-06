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
// sent. Per Ty's direction, Property is now an explicit runtime segment
// (PROPERTY constant below) rather than baked into the configured base
// URL - AVAIL_AVL_REPORTS_URL must end at ".../AVLReports/v1" (no trailing
// "/MVTA") for this feed specifically, unlike every other Avail feed in
// this app, which still bakes Property into their own base URL setting.
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

export interface AvailAvlEnvelope {
  errors: string[];
  result: {
    "AVL Reports": AvailAvlReport[];
    RefreshTime: string;
    Property: string;
    StartDate: string;
    EndDate: string;
  };
  success: boolean;
}

// Full "YYYY-MM-DD HH:MI:SS" per the confirmed spec - AVL Reports is the
// only feed in this file needing datetime (not date-only) precision, since
// its window is a rolling few minutes, not a whole day/month.
function formatDateTimeSql(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mi}:${ss}`;
}

// MVTA is the only property this app will ever query - hardcoded here
// rather than added as a new app setting, same "fixed, single-agency
// value" precedent as EARLY_THRESHOLD/LATE_THRESHOLD in otpMonthlyFeed.ts.
const PROPERTY = "MVTA";

// baseUrl is the agency-level URL with NO property segment, e.g.
// "https://avail360-api.myavail.cloud/AVLReports/v1" - Property is appended
// fresh below, per the confirmed spec. startDate/endDate must be within a
// 24-hour window per the feed's own documented max.
export async function fetchAvlReports(
  baseUrl: string,
  apiKey: string,
  startDate: Date,
  endDate: Date,
): Promise<AvailAvlReport[]> {
  // encodeURIComponent - the datetime format's space and colons aren't
  // valid raw in a URL path segment.
  const url =
    `${baseUrl.replace(/\/+$/, "")}/${PROPERTY}` +
    `/${encodeURIComponent(formatDateTimeSql(startDate))}` +
    `/${encodeURIComponent(formatDateTimeSql(endDate))}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    // Diagnostic: capture the response body - APIM commonly returns a
    // routing-diagnostic message on a 404 (e.g. "no matching operation
    // found") that the previous version of this error discarded. Confirmed
    // live 2026-08-05: the fix to send Property + two full datetime
    // segments still 404'd, so the actual cause is still unconfirmed -
    // this is the next diagnostic step, not a guess at the fix itself.
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* body not readable - status code is all we get */
    }
    throw new Error(`Avail AVL Reports request failed: ${res.status} - ${body.slice(0, 500)} (url: ${url})`);
  }
  const payload = (await res.json()) as AvailAvlEnvelope;
  if (!payload.success) {
    throw new Error(
      `Avail AVL Reports API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`,
    );
  }
  return payload.result?.["AVL Reports"] ?? [];
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
  const timestamp = new Date(report.Timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

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
