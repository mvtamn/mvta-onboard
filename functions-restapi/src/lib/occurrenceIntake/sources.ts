// What each source observes that is worth an occurrence, and the reference
// that names that observation. The rules below decide which source rows become
// candidates; lib/occurrenceIntake decides whether a candidate is assigned,
// scored, and writable. GET /fixed-route-departures and GET /on-demand-departures
// read the same rules, so a row is judged the same way on both sides.
import type { KpiTrustState } from "../kpiTrust";
import { agencyServiceDate } from "../missedTripTime";
import { DEPARTURE_OUTCOME_STATUSES } from "../fixedRouteDepartureOutcome";
import { missedTripSourceRefSql } from "../missedTripCase/classify";

// How late a pullout must be before it is worth a contractor's review.
//
// Avail's PulloutStatus is a timing state, not an outcome. "Expired Pullout"
// says the scheduled pullout window elapsed - it does not say the bus never
// left, and in practice most of those runs do leave, a couple of minutes late.
// Raising a candidate on the status alone made roughly one pullout in seven a
// reviewable occurrence, which buries the reviewer and, because a period cannot
// be finalized while any candidate is unreviewed, blocks assessment behind a
// queue that is mostly dismissals.
//
// onboard-spare-integration-spec.md section 9.1 always intended a threshold
// ("flag rows exceeding a configurable variance threshold (e.g. >10 min
// late)"); the candidate rule simply never got one. Ten minutes is that
// example, overridable per environment while section 10's open item 9 - whether
// these thresholds should be admin-managed - is still undecided.
const DEFAULT_VARIANCE_MINUTES = 10;

export function garageDepartureVarianceSeconds(
  raw: string | undefined = process.env.GARAGE_DEPARTURE_VARIANCE_MINUTES,
): number {
  // An empty setting is an absent one. Number("") is 0, so trusting it would
  // read a blank app setting as a deliberate zero variance and make every late
  // departure reviewable - the exact flood this threshold exists to stop.
  const configured = raw?.trim();
  const parsed = configured ? Number(configured) : Number.NaN;
  const minutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VARIANCE_MINUTES;
  return Math.round(minutes * 60);
}

// The statuses that describe how a run's DEPARTURE ended.
//
// Avail's PulloutStatus is a precedence-ordered ladder: a pullout row shows the
// single highest-precedence status that currently applies, so the value moves
// as the run progresses. The vendor's own table settles what each one means and
// corrects two readings this list was built on:
//
//   Missed Login (10) is NOT terminal. The Late Login note says a status "can
//   change from Missed Login to either Waiting for Pullout or Late Login" - it
//   means login has not happened YET.
//
//   Missed Pullout (14) is NOT terminal either: "no longer valid if the vehicle
//   is detected on Route".
//
//   Expired Pullout (16) is the settled one, and says so: it "takes precedence
//   over Missed Check In, Missed Log In, and Missed Pull Out after this timer
//   has expired".
//
//   On Route No Pullout (17) means the vehicle IS running - "the driver did not
//   log on before leaving the yard". A missing pullout RECORD, not a missing
//   departure, which is why it stays out of this list.
//
//   Late Relief (19) is a mid-shift driver changeover, not a pullout at all. It
//   headed this list for months and the feed has never emitted it.
//
// Two intermediate statuses are still listed, because 408 historical rows show
// they are frequently where a run's day actually ends - Avail does not always
// supersede them. What makes that safe is the settled-day guard below, not the
// status: once the service day is over, the value has stopped moving.
//
// The feed also emits four pull-in values that this table does not document at
// all - On Time Pullin, Late Pullin, Missed Pullin and Waiting for Pullin,
// nearly 2,000 rows. They mirror the pullout ladder for the other end of the
// run: a pull-in is the vehicle returning to the depot, so its departure already
// happened, and none of them are departure evidence.
//
// Their absence from this standard is a SCOPE decision, not a technical one,
// and the distinction is worth stating because the data invites the opposite
// conclusion: 877 of those rows are late returns, and finding that number with
// no standard attached to it reads like an oversight. It is not. The agreement
// measures the pull-out; a late return is observable but not a performance
// measure today. If the agency later expands its standards to cover returns,
// the evidence is already being collected and this is where that would hook in
// - as its own standard, not by widening a departure rule to match a status
// that describes the wrong end of the run.
//
// Reading only the latest status looks like it should lose the departure
// outcome of every run that got far enough to come back - most of them, since
// pull-in rows outnumber pullout rows. It does not, and the reason is worth
// keeping: precedence does not just order the ladder, it makes a bad rung
// STICK. A run that departs late keeps Late Pullout (15) or Expired Pullout
// (16) even after it pulls in, because those outrank the pull-in values;
// only a clean departure advances to a pull-in status.
//
// That was measured, not assumed. Of 1,952 pull-in rows, the number carrying a
// departure more than the variance late is zero, and the worst hidden case is
// six minutes - inside the variance, so it would be dismissed even if it were
// visible. Three have no departure at all, which is 0.15% and is noise.
//
// So matching on status is sound here, and this is the property that makes it
// sound. Do not "fix" the apparent gap: the check above is what it costs to
// find out there is no gap, and it comes back zero.
//
// The list stays an allowlist rather than a denylist for one reason: Tripper (1)
// is a manually duplicated row whose other statuses the vendor calls
// "questionable", and a denylist would have to remember to exclude it. An
// allowlist excludes it by construction. The cost is that an unlisted status is
// ignored in silence, which is why the Red conditions below are listed before
// they are ever seen.
//
// Over 22 service days the feed produced eleven values, and they fall into
// three groups:
//
//   Departure outcomes, listed below - Missed Pullout (282 rows, none departed),
//   Missed Login (126, none departed), Expired Pullout (510, 278 never departed
//   and the rest mostly a few minutes late) and Late Pullout (91, all departed,
//   averaging 9 minutes late).
//
//   Pull-IN outcomes - On Time Pullin, Late Pullin, Missed Pullin, Waiting for
//   Pullin. Nearly 1,900 rows describing a run's RETURN to the garage, which
//   means its departure already happened. They are not departure evidence and
//   must never reach a departure standard.
//
//   Not an outcome yet - On Time Pullout is a clean departure, and a blank
//   status is a run Avail has not classified. Every blank row seen was from the
//   current service day only, so blank means "still resolving", not "missed".
//   Raising a candidate on one would penalise a run before Avail has finished
//   judging it.
//
// 'Late Relief' used to head this list and appears in no row of 22 days of
// data - it came from the single sample payload the fixtures were built from.
// Meanwhile Missed Pullout and Missed Login, 408 runs that provably never left
// the garage, matched nothing. The list was wrong in both directions at once,
// which is why it is now grounded in the feed rather than in a sample.
//
// 'On Route No Pullout' is deliberately absent. Twelve of its thirteen rows
// have no departure, but the name says the vehicle IS running, so it reads as a
// missing pullout RECORD rather than a missing departure. That is a data
// question for Avail, not a contractor penalty.
// The list itself lives in lib/fixedRouteDepartureOutcome.ts so that GET
// /fixed-route-departures judges each row by the same rule the poll raises
// candidates from; the reasoning stays here.
//
// Avail's table documents five more Red conditions that stop a departure
// happening - Missing Operator Assignment (2), Missing Vehicle Assignment (3),
// Invalid Vehicle Assignment (4), Duplicate Vehicle Assignment (5) and Missed
// Check-in (7). None is listed, and their absence is deliberate.
//
// Avail confirmed on 2026-09-05 that MVTA has no operator scheduling package,
// so the vendor never ingests the data that raises any of them. They are not
// rare here, they are unreachable. Avail's guidance on which spelling to use
// was "use the spelling from the feed", and since none has ever reached the
// feed there is no spelling to match on.
//
// They were briefly listed on the reasoning that an allowlist which omits a
// status fails by going silent. That reasoning holds - it is how this rule
// once ignored 408 undeparted runs - but listing five strings that can never
// match was the wrong remedy, because it reads as coverage while providing
// none. unknownPulloutStatuses in availPullout.ts is the right one: these
// statuses are absent from its known set too, so if MVTA ever adopts an
// operator scheduling package and they start arriving, the poll names them,
// with their real spellings, and they can be added on evidence.

// A garage departure is worth reviewing when a run whose departure has been
// judged had a scheduled pullout and either never departed, or departed more
// than the variance late.
//
// The status says the departure has been decided; the timestamps say what
// happened. Neither alone is enough: the status alone called a bus that left
// four minutes late a breach, and the timestamps alone would flag a run Avail
// has not finished classifying.
//
// A row with no scheduled pullout is deliberately not a candidate. There is no
// committed time to have missed, so it is a gap in the source rather than a
// breach, and the repo already refuses to turn absent evidence into a finding
// (see the unknown_data_gap handling in gtfsMissedTripsPoll).
export function garageDepartureCandidatePredicate(): string {
  const statuses = DEPARTURE_OUTCOME_STATUSES.map((status) => `'${status}'`).join(",");
  return `d.pullout_status IN (${statuses})
            AND d.service_date < @settled_before
            AND d.pullout_scheduled IS NOT NULL
            AND (
              d.pullout_actual IS NULL
              OR DATEDIFF(SECOND, d.pullout_scheduled, d.pullout_actual) > @variance_seconds
            )`;
}

// The on-demand half of the same rule (ADR 0028: one concept, one source per
// service type). Spare has no status ladder; a duty is judged on its
// timestamps alone once its day is settled: a scheduled start that either
// never produced a departure from either source, or was departed more than the
// variance late. A cancelled duty had no departure to make. A duty with no
// scheduled start is a gap in the source, not a breach, for the same reason as
// the fixed-route rule above.
export function onDemandDepartureCandidatePredicate(): string {
  return `d.service_date < @settled_before
            AND d.departure_scheduled IS NOT NULL
            AND LOWER(ISNULL(d.duty_status, N'')) <> N'cancelled'
            AND (
              d.departure_actual IS NULL
              OR DATEDIFF(SECOND, d.departure_scheduled, d.departure_actual) > @variance_seconds
            )`;
}

// The per-source gate the ADR asks for. A departure feed that is not
// trustworthy must not raise candidates, because a candidate is never
// withdrawn. Unlike the missed-trip gates, current-but-empty passes: this poll
// runs at 01:20 agency-local, when a departures feed has legitimately had
// nothing to report for hours, and that quiet is not a reason to distrust
// yesterday's settled rows.
export function departureSourceAllowed(state: KpiTrustState | undefined): boolean {
  return state === "current" || state === "current_but_empty";
}

// A run is only judged once its service day is over.
//
// PulloutStatus moves as a run progresses, so reading it mid-day can catch a
// value that has not settled: a run sitting at Missed Login this afternoon may
// be Late Pullout by tonight. The candidate poll runs at 01:20 agency-local, when the
// current service date has barely begun and the previous one ended three hours
// ago, so excluding the current date is what makes the intermediate statuses
// above safe to act on.
//
// It matters more than a status list can. The MERGE that raises candidates only
// inserts on no-match, so a candidate raised against an in-flight run is never
// withdrawn when that run departs - the false positive would outlive the
// condition that caused it and sit in the review queue for good.
export function settledServiceDateExclusive(now: Date = new Date()): string {
  return agencyServiceDate(now).serviceDate;
}

// The source of an occurrence. Its reference (source_ref) is the one key the
// intake dedupes on and relief reads the observing system from, so it is built
// and read here only. The formats predate this module and live in stored rows
// (migration 097 rewrote the fixed-route ones); they must not change.
//
// References name the source system, per ADR 0028, so one physical departure
// can never be raised twice against GARAGE_DEPARTURE: the fixed-route
// reference says avail_pullout and the on-demand one says spare_duties.
export type OccurrenceSourceKind = "missed_trip" | "fixed_route_departure" | "on_demand_departure";

export type OccurrenceSource =
  | { kind: "missed_trip"; system: "gtfs" | "spare"; record_id: string; service_date: string }
  | { kind: "fixed_route_departure"; service_date: string; block: string; run: string }
  // Keyed by duty id alone: OnDemandDepartures holds one row per duty, and a
  // duty is one departure however its service date is later revised.
  | { kind: "on_demand_departure"; duty_id: string };

export const FIXED_ROUTE_DEPARTURE_SOURCE = "avail_pullout";
export const ON_DEMAND_DEPARTURE_SOURCE = "spare_duties";

const PREFIX = {
  missed_trip: "MonitoredMissedTrips:",
  fixed_route_departure: `FixedRouteDepartures:${FIXED_ROUTE_DEPARTURE_SOURCE}:`,
  on_demand_departure: `OnDemandDepartures:${ON_DEMAND_DEPARTURE_SOURCE}:`,
} as const;

// The reference as a SQL expression over a source row. `alias` is the source
// table's alias: MonitoredMissedTrips, FixedRouteDepartures or OnDemandDepartures.
export function occurrenceSourceRefSql(kind: OccurrenceSourceKind, alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("occurrenceSourceRefSql alias must be a plain identifier");
  if (kind === "missed_trip") return missedTripSourceRefSql(alias);
  if (kind === "fixed_route_departure") return `CONCAT(N'${PREFIX.fixed_route_departure}',${alias}.service_date,N'|',${alias}.block,N'|',${alias}.run)`;
  return `CONCAT(N'${PREFIX.on_demand_departure}',${alias}.duty_id)`;
}

// A stored reference read back. Null for a hand-entered occurrence, and for a
// reference no source here writes.
export function parseOccurrenceSource(ref: string | null | undefined): OccurrenceSource | null {
  if (!ref) return null;
  if (ref.startsWith(PREFIX.missed_trip)) {
    const rest = ref.slice(PREFIX.missed_trip.length);
    const colon = rest.indexOf(":"), bar = rest.lastIndexOf("|");
    const system = rest.slice(0, colon);
    if ((system !== "gtfs" && system !== "spare") || bar < colon) return null;
    return { kind: "missed_trip", system, record_id: rest.slice(colon + 1, bar), service_date: rest.slice(bar + 1) };
  }
  if (ref.startsWith(PREFIX.fixed_route_departure)) {
    const [service_date, block, run] = ref.slice(PREFIX.fixed_route_departure.length).split("|");
    if (block === undefined || run === undefined) return null;
    return { kind: "fixed_route_departure", service_date, block, run };
  }
  if (ref.startsWith(PREFIX.on_demand_departure)) return { kind: "on_demand_departure", duty_id: ref.slice(PREFIX.on_demand_departure.length) };
  return null;
}

// Which system observed a source, for outage relief (ADR 0012). Avail's CAD/AVL
// feeds both GTFS-RT and pullouts; Spare runs on-demand.
export type ObservingSystem = "Avail_CAD_AVL" | "Spare";

export function observingSystem(source: OccurrenceSource | null): ObservingSystem | null {
  if (!source) return null;
  if (source.kind === "missed_trip") return source.system === "spare" ? "Spare" : "Avail_CAD_AVL";
  return source.kind === "fixed_route_departure" ? "Avail_CAD_AVL" : "Spare";
}

// The same answer as a SQL CASE over a stored reference, so scoring and the
// report exclude the same rows the API labels.
export function observingSystemSql(refExpr: string): string {
  return `CASE WHEN ${refExpr} LIKE '${PREFIX.fixed_route_departure}%' THEN 'Avail_CAD_AVL' WHEN ${refExpr} LIKE '${PREFIX.missed_trip}gtfs:%' THEN 'Avail_CAD_AVL' WHEN ${refExpr} LIKE '${PREFIX.missed_trip}spare:%' THEN 'Spare' WHEN ${refExpr} LIKE '${PREFIX.on_demand_departure}%' THEN 'Spare' END`;
}
