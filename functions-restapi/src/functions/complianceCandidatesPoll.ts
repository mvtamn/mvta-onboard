import { app, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { loadKpiTrust } from "../lib/kpiTrustStore";
import { agencyServiceDate } from "../lib/missedTripTime";

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
// nearly 1,900 rows. They describe a run's RETURN, so its departure already
// happened, and none of them are departure evidence.
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
const DEPARTURE_OUTCOME_STATUSES = [
  "Missed Pullout",
  "Missed Login",
  "Expired Pullout",
  "Late Pullout",
] as const;

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
      const ready = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NOT NULL
          AND OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL
          AND OBJECT_ID('dbo.FixedRouteDepartures','U') IS NOT NULL THEN 1 ELSE 0 END ready
      `);
      if (!ready.recordset[0]?.ready) { context.warn("Compliance candidate tables are not ready; migration 030 may be pending."); return; }
      const candidateRequest = pool.request();
      candidateRequest.input("allow_fixed_missed_trips", allowFixedMissedTrips ? 1 : 0);
      candidateRequest.input("allow_spare_missed_trips", allowSpareMissedTrips ? 1 : 0);
      candidateRequest.input("variance_seconds", sql.Int, garageDepartureVarianceSeconds());
      candidateRequest.input("settled_before", sql.Char(8), settledServiceDateExclusive());
      const result = await candidateRequest.query<{ inserted: number }>(`
        DECLARE @contractor UNIQUEIDENTIFIER=(SELECT TOP 1 id FROM Contractors WHERE is_active=1 ORDER BY updated_at DESC);
        IF @contractor IS NULL THROW 50001,'No active contractor is configured.',1;
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
            CONCAT(N'FixedRouteDepartures:',d.service_date,N'|',d.block,N'|',d.run) source_ref
          FROM FixedRouteDepartures d CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='GARAGE_DEPARTURE'
            AND ${garageDepartureCandidatePredicate()}
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
