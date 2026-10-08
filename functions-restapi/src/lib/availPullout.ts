// Avail360 Pullout Reports - a second, distinct Avail proprietary API from
// AVL Reports (availAvl.ts): dispatch-side check-in/login/pullout timing per
// block/run, both scheduled and actual, with Avail's own PulloutStatus
// classification (e.g. "Late Relief", "Expired Pullout"). More authoritative
// for garage-side lateness than anything inferred from GTFS or AVL data.
// The envelope shape is genuinely different from AVL Reports' - result.Pullout
// (not result["AVL Reports"]), with RefreshTime/Property nested in a
// result.results array rather than as sibling fields.
import { agencyLocalDateTimeToUtc, agencyServiceDate } from "./missedTripTime";

export interface AvailPulloutReport {
  Block: number;
  Run: number;
  Checkin_Scheduled: string | null;
  Checkin_Actual: string | null;
  Login_Scheduled: string | null;
  Login_Actual: string | null;
  Pullout_Scheduled: string | null;
  Pullout_Actual: string | null;
  PulloutStatus: string | null;
  OperatorName: string | null;
  LogonID: number | null;
  VehicleLabel: string | null;
}

export interface MappedPullout {
  service_date: string;
  block: number;
  run: number;
  checkin_scheduled: Date | null;
  checkin_actual: Date | null;
  login_scheduled: Date | null;
  login_actual: Date | null;
  pullout_scheduled: Date | null;
  pullout_actual: Date | null;
  pullout_status: string | null;
  operator_name: string | null;
  logon_id: number | null;
  vehicle_label: string | null;
}

// Avail sends these as agency-local wall clock. Some values carry a trailing
// 'Z' and the sample payload the fixtures came from carried it throughout, but
// the suffix is not to be believed: taking it at face value stored every time
// five hours early, which is how this feed came to report a 04:41 pullout as
// 11:41 PM and to file each roster's early-morning tail under the previous
// service date.
//
// The proof is in data this repo already holds. TripStartLog.scheduled_start_at
// is a genuine UTC instant (serviceDateAndGtfsSecondsToUtc builds it from GTFS).
// Line each block's pullout up against its own first trip of the day: read as
// UTC, every block leaves the garage about five and a half hours before the
// trip it is leaving for; read as agency-local, the gap is the 12 to 29 minutes
// of deadhead between the garage and the first stop.
//
// So the wall-clock digits are what is trusted, and they are placed in agency
// time. Any zone designator is discarded rather than honoured. Migration 138
// corrected the rows stored under the old reading.
function parseNullableDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts.slice(1, 6).map(Number);
  const second = Number(parts[6] ?? 0);
  // Guard clause, as elsewhere here: a malformed report is skipped, not thrown
  // on, and Date.UTC would otherwise roll 2026-13-45 into a plausible-looking
  // instant.
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  return agencyLocalDateTimeToUtc({ year, month, day, hour, minute, second });
}

// The Pullout endpoint takes no date segment - it always reports the
// property's current service day - so the service date has to be derived, and
// it is part of the (service_date, block, run) key the poller MERGEs on.
// Deriving it from the poll clock in UTC broke that key: the UTC date rolls
// over at 6/7pm agency-local, mid-service, so an evening poll re-INSERTED runs
// already stored under the correct day and double-counted them. Anchor to the
// run's own garage times in agency-local time instead. Scheduled times are
// preferred over actuals (a run's service day is fixed by its schedule, not by
// when it happened to leave), and garage times sit in the early morning, far
// from local midnight, so every poll across the day derives the same date and
// the MERGE stays idempotent. The poll clock is only a last resort for a report
// carrying no usable timestamp at all.
//
// Avail's timestamps reach this function as real UTC instants (see
// parseNullableDate), so the agency-local conversion below is applied exactly
// once and the service day runs midnight to midnight in agency time.
export function pulloutServiceDate(
  report: Pick<
    MappedPullout,
    | "checkin_scheduled"
    | "checkin_actual"
    | "login_scheduled"
    | "login_actual"
    | "pullout_scheduled"
    | "pullout_actual"
  >,
  now: Date = new Date(),
): string {
  const anchor =
    report.pullout_scheduled ??
    report.login_scheduled ??
    report.checkin_scheduled ??
    report.pullout_actual ??
    report.login_actual ??
    report.checkin_actual ??
    now;
  return agencyServiceDate(anchor).serviceDate;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapVehiclePositionEntity).
export function mapPulloutReport(
  report: AvailPulloutReport,
  now: Date = new Date(),
): MappedPullout | null {
  if (typeof report.Block !== "number" || typeof report.Run !== "number") {
    return null;
  }

  const times = {
    checkin_scheduled: parseNullableDate(report.Checkin_Scheduled),
    checkin_actual: parseNullableDate(report.Checkin_Actual),
    login_scheduled: parseNullableDate(report.Login_Scheduled),
    login_actual: parseNullableDate(report.Login_Actual),
    pullout_scheduled: parseNullableDate(report.Pullout_Scheduled),
    pullout_actual: parseNullableDate(report.Pullout_Actual),
  };

  return {
    service_date: pulloutServiceDate(times, now),
    ...times,
    block: report.Block,
    run: report.Run,
    pullout_status: report.PulloutStatus ?? null,
    operator_name: report.OperatorName ?? null,
    logon_id: report.LogonID ?? null,
    vehicle_label: report.VehicleLabel ?? null,
  };
}

// Every PulloutStatus this repo knows how to reason about.
//
// The list matters because of how the compliance rule fails. Its status
// allowlist raises nothing for a value it does not recognise - no error, no
// row, just silence - which is how GARAGE_DEPARTURE ignored 408 runs that never
// left the garage while matching a status the feed has never sent. A value
// arriving here that nobody has accounted for is the first symptom, and without
// this it is invisible until someone queries the table by hand.
//
// These are Avail's documented statuses in precedence order, minus five, plus
// four the document omits.
//
// Left out on purpose: Missing Operator Assignment (2), Missing Vehicle
// Assignment (3), Invalid Vehicle Assignment (4), Duplicate Vehicle Assignment
// (5) and Missed Check-in (7). Avail confirmed on 2026-09-05 that MVTA has no
// operator scheduling package, so it never ingests the data that raises them.
// Calling them "known" would be the worse mistake of the two available: it
// would keep this quiet for the one event worth hearing about, an unreachable
// status becoming reachable because MVTA adopted a scheduling package. Absent
// from this set, that arrival is reported, with the spelling the feed actually
// uses.
//
// Added because the document omits them: the four pull-in values, the largest
// group in the feed. Their absence is why the document cannot be treated as a
// complete reference, and why the spellings here are worth distrusting - it
// writes "Pull In At Risk" for a concept the feed sends as "Pullin".
const KNOWN_PULLOUT_STATUSES = new Set(
  [
    "Tripper",
    "Waiting for Check-in",
    "Late Check-in",
    "Waiting for Login",
    "Missed Login",
    "Late Login",
    "Waiting for Pullout",
    "On Time Pullout",
    "Missed Pullout",
    "Late Pullout",
    "Expired Pullout",
    "On Route No Pullout",
    "On Time Relief",
    "Late Relief",
    "Pull In At Risk",
    // Absent from the document. Pull-in is the return leg, so none of these is
    // departure evidence.
    "On Time Pullin",
    "Late Pullin",
    "Missed Pullin",
    "Waiting for Pullin",
  ].map((status) => status.toLowerCase()),
);

// The distinct statuses in this delivery that nothing here accounts for.
//
// Compared case-insensitively because the compliance rule matches in SQL, whose
// collation is too. A value that differs only in case still works there, so
// warning about it would be noise; a value that differs in punctuation - the
// realistic risk, "Missed Checkin" against the documented "Missed Check-in" -
// does not work, and is reported.
//
// A blank status is not unknown. It is Avail still resolving a run, and every
// blank row observed carried the current service date.
export function unknownPulloutStatuses(reports: readonly AvailPulloutReport[]): string[] {
  const unknown = new Map<string, string>();
  for (const report of reports) {
    const status = report.PulloutStatus?.trim();
    if (!status) continue;
    const key = status.toLowerCase();
    if (!KNOWN_PULLOUT_STATUSES.has(key)) unknown.set(key, status);
  }
  return [...unknown.values()].sort();
}
