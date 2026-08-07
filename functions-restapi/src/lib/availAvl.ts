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

// CONFIRMED live 2026-08-07: Avail360 interprets these two datetime segments
// in AGENCY LOCAL time, not UTC. Proof from the feed's own response body -
// a poll that sent window [2026-08-07 20:45:00 -> 2026-08-07 20:55:00]
// (built from getUTC* components, as this function previously did) came back
// status=200 success=true with an empty "AVL Reports" array and
// RefreshTime "2026-08-07T15:55:00.820" - Avail's own notion of "now",
// exactly five hours (UTC-5, CDT) behind the window we asked for. Every
// poll was therefore requesting a window five hours in the FUTURE, which
// this API reports as an empty result rather than an error - which is why
// vehicles demonstrably logged into runs produced "0 reports seen" on every
// single poll. Formatting in America/Chicago fixes it, and handles the
// CDT/CST transition on its own rather than hardcoding an offset.
const AGENCY_TIME_ZONE = "America/Chicago";

// Full "YYYY-MM-DD HH:MI:SS" per the confirmed spec - AVL Reports is the
// only feed in this file needing datetime (not date-only) precision, since
// its window is a rolling few minutes, not a whole day/month. hourCycle
// "h23" (not hour12: false) so midnight formats as 00, not 24.
function formatDateTimeSql(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// MVTA is the only property this app will ever query - hardcoded here
// rather than added as a new app setting, same "fixed, single-agency
// value" precedent as EARLY_THRESHOLD/LATE_THRESHOLD in otpMonthlyFeed.ts.
const PROPERTY = "MVTA";

// Strips a trailing slash, then a trailing "/MVTA" segment (case-
// insensitive) if present - so AVAIL_AVL_REPORTS_URL can be configured
// either as ".../AVLReports/v1" or ".../AVLReports/v1/MVTA" and PROPERTY
// is still appended exactly once below. Prevents ".../MVTA/MVTA/..." if
// the setting is ever changed to match the other feeds' convention.
function normalizeBaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.replace(/\/+$/, "");
  return trimmed.replace(new RegExp(`/${PROPERTY}$`, "i"), "");
}

// baseUrl is the agency-level URL, with or without a trailing property
// segment (see normalizeBaseUrl above) - e.g.
// "https://avail360-api.myavail.cloud/AVLReports/v1". startDate/endDate
// must be within a 24-hour window per the feed's own documented max.
export async function fetchAvlReports(
  baseUrl: string,
  apiKey: string,
  startDate: Date,
  endDate: Date,
): Promise<AvailAvlReport[]> {
  const startStr = formatDateTimeSql(startDate);
  const endStr = formatDateTimeSql(endDate);
  // CONFIRMED live 2026-08-06: Ty ran this feed directly via curl with the
  // space escaped as %20 but colons left LITERAL (not %3A) and got real
  // vehicle data back - the same request this code was previously sending
  // (encodeURIComponent, which also escapes colons to %3A) had returned a
  // clean success=true with an always-empty "AVL Reports" array for the
  // prior 14 days straight. Avail's API apparently accepts an unescaped
  // colon in this path segment but silently no-ops (no error) on an
  // escaped one - encodeURIComponent() is the wrong tool here even though
  // colons and spaces are both technically reserved in a URL path segment.
  // encodeDateTimeSegment escapes ONLY the space, to match exactly.
  const encodeDateTimeSegment = (s: string) => s.replace(/ /g, "%20");
  const url =
    `${normalizeBaseUrl(baseUrl)}/${PROPERTY}` +
    `/${encodeDateTimeSegment(startStr)}` +
    `/${encodeDateTimeSegment(endStr)}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });

  // Read the body once as text, regardless of status - needed for the
  // diagnostic log below either way, and res.json()/res.text() can each
  // only be called once per Response.
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* body not readable - status code is all we get */
  }

  // Diagnostic (added 2026-08-06): the feed has reported zero vehicles
  // system-wide for 24+ consecutive hours despite success=true responses -
  // this logs the RAW response on every single call, success or failure,
  // via console.log (captured into Application Insights traces the same
  // as context.log, since this lib function has no InvocationContext of
  // its own). Confirms/denies, from one trace line: (1) whether Avail
  // itself returned an empty "AVL Reports" array vs. us mis-parsing a
  // populated one, (2) the exact {Start DateTime}/{End DateTime} strings
  // sent - format, and that they're built in agency-local time. This is the
  // log line that ACTUALLY diagnosed the empty-result bug: comparing the
  // window sent against the RefreshTime Avail echoed back is what showed
  // the five-hour offset (see AGENCY_TIME_ZONE above), so keep logging
  // both. (3) the exact Property casing sent (PROPERTY
  // is a literal "MVTA" constant, always this same casing). Body truncated
  // to 2000 chars to bound trace volume if Avail ever returns a large
  // live payload.
  console.log(
    `Avail AVL Reports raw response: status=${res.status} url=${url} ` +
      `window(${AGENCY_TIME_ZONE})=[${startStr} -> ${endStr}] bodyLength=${body.length} ` +
      `body=${body.slice(0, 2000)}`,
  );

  if (!res.ok) {
    // APIM commonly returns a routing-diagnostic message on a 404 (e.g.
    // "no matching operation found") - surfaced in the throw, and also
    // already captured in the raw-response log line above.
    throw new Error(`Avail AVL Reports request failed: ${res.status} - ${body.slice(0, 500)} (url: ${url})`);
  }

  let payload: AvailAvlEnvelope;
  try {
    payload = JSON.parse(body) as AvailAvlEnvelope;
  } catch (err) {
    throw new Error(
      `Avail AVL Reports returned unparseable JSON (status ${res.status}): ${body.slice(0, 500)}`,
    );
  }
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
