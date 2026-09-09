import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import type { KpiTrustState } from "../lib/kpiTrust";
import { loadKpiTrust } from "../lib/kpiTrustStore";
import { agencyServiceDate } from "../lib/missedTripTime";
import { DEPARTURE_OUTCOME_STATUSES } from "../lib/fixedRouteDepartureOutcome";

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
// /fixed-route-departures judges each row by the same rule this poll raises
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

// Source references name the source system, per ADR 0028, so one physical
// departure can never be raised twice against GARAGE_DEPARTURE: the fixed
// route reference says avail_pullout and the on-demand one says spare_duties,
// and migration 097 rewrote the pre-existing fixed-route references into this
// shape. Both are SQL expressions over a row aliased d.
export const FIXED_ROUTE_DEPARTURE_SOURCE = "avail_pullout";
export const ON_DEMAND_DEPARTURE_SOURCE = "spare_duties";

export function fixedRouteDepartureSourceRefSql(): string {
  return `CONCAT(N'FixedRouteDepartures:${FIXED_ROUTE_DEPARTURE_SOURCE}:',d.service_date,N'|',d.block,N'|',d.run)`;
}

export function onDemandDepartureSourceRefSql(): string {
  // Keyed by duty id alone: OnDemandDepartures holds one row per duty, and a
  // duty is one departure however its service date is later revised.
  return `CONCAT(N'OnDemandDepartures:${ON_DEMAND_DEPARTURE_SOURCE}:',d.duty_id)`;
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
// be Late Pullout by tonight. This poll runs at 01:20 agency-local, when the
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

// One Agreement has exactly one Assessment Contractor (ADR 0005), and this
// poller has no route, division, or source-to-contractor rule to choose by.
// So it attributes every candidate to the active contractor only while there
// is exactly one. Two active contractors is not a tie to break by updated_at -
// editing a contractor record would silently move every future candidate - it
// is a configuration the poller must refuse until an attribution rule exists.
export function assessmentContractorSql(): string {
  return `
        DECLARE @active_contractors INT=(SELECT COUNT(*) FROM Contractors WHERE is_active=1);
        IF @active_contractors=0 THROW 50001,'No active contractor is configured.',1;
        IF @active_contractors>1 THROW 50003,'More than one active contractor is configured; candidate attribution is ambiguous until a source-to-contractor rule exists.',1;
        DECLARE @contractor UNIQUEIDENTIFIER=(SELECT id FROM Contractors WHERE is_active=1);`;
}

// Existing feed-specific review remains authoritative. This poller only copies
// eligible observations into the governed assessment queue and never confirms
// contractor attribution or creates a penalty.
app.timer("complianceCandidatesPoll", {
  schedule: "0 20 6 * * *",
  handler: async (_timer, context: InvocationContext) => {
    try {
      const pool = await getPool();
      const trust = await loadKpiTrust(pool);
      const allowFixedMissedTrips = trust.fixed_route_missed_trips.state === "current";
      const allowSpareMissedTrips = trust.spare_missed_trips.state === "current";
      const allowFixedRouteDepartures = departureSourceAllowed(trust.fixed_route_departures?.state);
      const allowOnDemandDepartures = departureSourceAllowed(trust.on_demand_departures?.state);
      const ready = await pool.request().query<{ ready: number; on_demand_ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NOT NULL
          AND OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL
          AND OBJECT_ID('dbo.FixedRouteDepartures','U') IS NOT NULL THEN 1 ELSE 0 END ready,
          CASE WHEN OBJECT_ID('dbo.OnDemandDepartures','U') IS NOT NULL THEN 1 ELSE 0 END on_demand_ready
      `);
      if (!ready.recordset[0]?.ready) { context.warn("Compliance candidate tables are not ready; migration 030 may be pending."); return; }
      // The on-demand table arrives with migration 096b; until it exists the
      // Spare half is simply absent, which ADR 0028 says is the right reading
      // of a departure with no source for its service type.
      const onDemandReady = ready.recordset[0]?.on_demand_ready === 1;
      if (!onDemandReady) context.warn("OnDemandDepartures is missing (migration 096b); on-demand garage departures raise no candidates.");
      if (!allowFixedRouteDepartures) context.warn(`Fixed-route departures feed is ${trust.fixed_route_departures?.state ?? "unknown"}; no fixed-route garage-departure candidates this run.`);
      if (onDemandReady && !allowOnDemandDepartures) context.warn(`On-demand departures feed is ${trust.on_demand_departures?.state ?? "unknown"}; no on-demand garage-departure candidates this run.`);
      const candidateRequest = pool.request();
      candidateRequest.input("allow_fixed_missed_trips", allowFixedMissedTrips ? 1 : 0);
      candidateRequest.input("allow_spare_missed_trips", allowSpareMissedTrips ? 1 : 0);
      candidateRequest.input("allow_fixed_route_departures", allowFixedRouteDepartures ? 1 : 0);
      candidateRequest.input("allow_on_demand_departures", onDemandReady && allowOnDemandDepartures ? 1 : 0);
      candidateRequest.input("variance_seconds", sql.Int, garageDepartureVarianceSeconds());
      candidateRequest.input("settled_before", sql.Char(8), settledServiceDateExclusive());
      const result = await candidateRequest.query<{ inserted: number }>(`
        ${assessmentContractorSql()}
        DECLARE @agreement_start DATE,@agreement_end DATE;
        SELECT TOP 1 @agreement_start=starts_on,@agreement_end=ends_on FROM PerformanceAgreements WHERE contractor_id=@contractor AND is_active=1;
        IF @agreement_start IS NULL THROW 50002,'No active Performance Agreement is configured.',1;
        DECLARE @inserted TABLE(id UNIQUEIDENTIFIER);

        MERGE ComplianceOccurrences WITH(HOLDLOCK) target
        USING (
          SELECT standard.id standard_id,@contractor contractor_id,LEFT(m.service_date,8) service_date,
            1 quantity,CAST(NULL AS INT) duration_days,CAST(NULL AS NVARCHAR(50)) qualifier_code,
            CONCAT(N'Missed trip ',m.trip_id,N' on route ',m.route_id) description,
            CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date) source_ref
          FROM MonitoredMissedTrips m CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='MISSED_TRIPS_FR' AND m.validation_status='confirmed' AND CONVERT(date,m.service_date,112) BETWEEN @agreement_start AND @agreement_end
            AND ((ISNULL(m.source_system,N'gtfs')=N'spare' AND @allow_spare_missed_trips=1)
              OR (ISNULL(m.source_system,N'gtfs')<>N'spare' AND @allow_fixed_missed_trips=1))
        ) source ON target.source_ref=source.source_ref
        WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,duration_days,qualifier_code,description,source,source_ref,review_status,attribution,created_by)
          VALUES(source.standard_id,source.contractor_id,source.service_date,source.quantity,source.duration_days,source.qualifier_code,source.description,'auto_candidate',source.source_ref,'candidate','undetermined','complianceCandidatesPoll')
        OUTPUT inserted.id INTO @inserted;

        MERGE ComplianceOccurrences WITH(HOLDLOCK) target
        USING (
          SELECT standard.id standard_id,@contractor contractor_id,d.service_date,1 quantity,
            CONCAT(N'Garage departure ',d.pullout_status,N' — block ',d.block,N', run ',d.run,N' — ',
              CASE WHEN d.pullout_actual IS NULL THEN N'no departure recorded'
                ELSE CONCAT(N'departed ',DATEDIFF(MINUTE,d.pullout_scheduled,d.pullout_actual),N' min late') END) description,
            ${fixedRouteDepartureSourceRefSql()} source_ref
          FROM FixedRouteDepartures d CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='GARAGE_DEPARTURE' AND @allow_fixed_route_departures=1
            AND ${garageDepartureCandidatePredicate()}
            AND CONVERT(date,d.service_date,112) BETWEEN @agreement_start AND @agreement_end
        ) source ON target.source_ref=source.source_ref
        WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,created_by)
          VALUES(source.standard_id,source.contractor_id,source.service_date,source.quantity,source.description,'auto_candidate',source.source_ref,'candidate','undetermined','complianceCandidatesPoll')
        OUTPUT inserted.id INTO @inserted;

        IF @allow_on_demand_departures=1
        MERGE ComplianceOccurrences WITH(HOLDLOCK) target
        USING (
          SELECT standard.id standard_id,@contractor contractor_id,d.service_date,1 quantity,
            CONCAT(N'Garage departure — on-demand duty ',ISNULL(d.duty_identifier,d.duty_id),N' — ',
              CASE WHEN d.departure_actual IS NULL THEN N'no departure recorded'
                ELSE CONCAT(N'departed ',DATEDIFF(MINUTE,d.departure_scheduled,d.departure_actual),N' min late') END,
              CASE d.departure_source WHEN N'slots_startLocation' THEN N' (start slot)'
                WHEN N'duties_firstSeenInServiceArea' THEN N' (first seen in service area)' ELSE N'' END,
              CASE d.scheduled_source WHEN N'duties_startRequested' THEN N'; schedule from the duty''s requested start' ELSE N'' END) description,
            ${onDemandDepartureSourceRefSql()} source_ref
          FROM OnDemandDepartures d CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='GARAGE_DEPARTURE'
            AND ${onDemandDepartureCandidatePredicate()}
            AND CONVERT(date,d.service_date,112) BETWEEN @agreement_start AND @agreement_end
        ) source ON target.source_ref=source.source_ref
        WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,created_by)
          VALUES(source.standard_id,source.contractor_id,source.service_date,source.quantity,source.description,'auto_candidate',source.source_ref,'candidate','undetermined','complianceCandidatesPoll')
        OUTPUT inserted.id INTO @inserted;

        SELECT COUNT(*) inserted FROM @inserted;
      `);
      context.log(`Compliance candidates: ${result.recordset[0]?.inserted ?? 0} new rows.`);
    } catch (error) { context.error("complianceCandidatesPoll failed", error); }
  },
});
