# Missed trips as the system of record: where it stands

**Date:** 2026-11-06. **Companion to**
[`docs/research/avail-vs-gtfs-rt-missed-trip-detection-2026-11-04.md`](../research/avail-vs-gtfs-rt-missed-trip-detection-2026-11-04.md),
which covers precision in depth, and to the OTP closeout
([`otp-system-of-record-closeout-2026-10-31.md`](otp-system-of-record-closeout-2026-10-31.md)),
whose shape this follows.

"System of record" here means OnBoard's Confirmed missed trips are the official count in
the contractor performance assessment (`MISSED_TRIPS_FR`, via occurrence intake), and they
replace whatever manual count MVTA keeps today.

**The short version: no, not today.** The plumbing is built. A confirmed case from a
promoted detector does reach occurrence intake in the same transaction as the review.
Nothing flows through that plumbing yet, for three reasons:

1. **Nobody is reviewing.** OnBoard holds 8 reviewer decisions, all from 6–8 August, all on
   legacy cases. No current case has ever been reviewed. Precision can't be measured and no
   detector can be promoted until someone decides cases.
2. **The detector isn't at the bar.** Of the 47 open escalations from `gtfs-silent-v4`,
   29 are contradicted by a start in another source, 16 can't be checked, and 2 look like
   real misses. The fixes from 4–5 November (#504, #506) have one clean service day behind
   them, and that day had zero cases. Nothing has been measured since the fixes.
3. **Nothing says what to count.** There is no agreed Attachment G definition in the repo:
   whether to count entire trips only or either end, how the $2,000 last-trip rule applies,
   or whether one standard covers both fixed route and microtransit. There is no named
   reviewer and no SOP, and today's manual process isn't written down anywhere OnBoard can
   be compared against.

Engineering can close the remaining code gaps in days. The critical path is people: a named
reviewer working the queue, plus Rob's answers on the definition.

---

## The gates

| # | Gate | State | One-line evidence (dev, read 2026-11-06 06:07 UTC) |
| --- | --- | --- | --- |
| 1 | Detection quality | **Fail** | 47 open v4 escalations: 29 contradicted, 16 unknown, 2 probable real. Post-fix there is one service day (5 Nov) with 0 cases. `gtfs-cancel-v1` has never opened a case. No Spare case has a ground truth |
| 2 | Promotion | **Fail** | `MissedTripDetectorPromotions` has 0 rows. Migrations 134 and 137 are **applied**: the table exists and `vw_MissedTrip` reads it. A promotion form exists on Admin → Missed-trip Detectors *(corrected 2026-11-06: an earlier version of this document said there was none)* |
| 3 | Review workflow | **Fail** | 8 reviews ever, last 2026-08-08. 12 people hold `compliance-review.review` (7 compliance-analyst, 5 compliance-manager) and none has used it in 90 days. The queue is not being worked |
| 4 | Hand-off to assessment | **Pass in code, unproven live** | `actOnMissedTripCase` → `recordOccurrence` runs in one transaction, gated on promotion and evidence conflict. There are 0 occurrences from reviews, 4 stale August candidates, and only 2 assessment periods (both `stale`). The last-trip $2,000 qualifier is never set by the review path |
| 5 | Evidence retention and audit | **Partial** | The review history is append-only. Avail is linked per record (11,307 links). GTFS evidence is read live at review time rather than snapshotted, and OTP Daily (#510's evidence) is purged after 90 days. Evidence conflicts ever recorded: 0 |
| 6 | Data feeds | **Pass for detection, with known limits** | TripUpdates and VehiclePositions are current. The Dispatch Log covers 5 Nov with 605/606 realised. OTP Daily and the Avail missed-trips feed are through 4 Nov. Avail Pullout and AVL have failed since 2026-11-04 16:55 UTC (Avail's SQL error), but neither feeds missed trips |
| 7 | Production | **Fail** | Prod runs `gtfsMissedTripsPoll` early (#446), but `availMissedTripsPoll`, `otpDailyFeedPoll`, the Spare ingest and evaluate timers, `complianceCandidatesPoll` and `assessmentPeriodOpen` are all disabled. Prod's DB can't be read from here because public access is off |
| 8 | Process and ownership | **Fail** | There's no agreed definition (design doc §12 Q1 and Q8 are still open), no named reviewer, no missed-trip SOP and no questions-for-Rob document. Today's manual count is undocumented |
| 9 | Open PRs | **Info** | #510 (OTP Daily departures as case evidence, 1.7.52) and #471 (evidence-wording review) are open. #430 (one freshness rule) touches feed health |

---

## 1. Detection quality: fail

**`gtfs-silent-v4`** has opened 182 cases since 2026-09-17 and none has been reviewed. The
week-by-week counts (Q23) never show an escalation reviewed:

| Week from | Cases | Escalated | Reviewed |
| --- | ---: | ---: | ---: |
| 2026-09-14 | 11 | 4 | 0 |
| 2026-09-21 | 35 | 11 | 0 |
| 2026-09-28 | 22 | 7 | 0 |
| 2026-10-05 | 23 | 1 | 0 |
| 2026-10-12 | 22 | 3 | 0 |
| 2026-10-19 | 19 | 5 | 0 |
| 2026-10-26 | 19 | 3 | 0 |
| 2026-11-02 | 31 | 13 | 0 |

With no reviewer outcomes, the scorecard's precision is empty. The cross-source check that
the 2026-11-04 research used, applied to all **47 open escalations** (Q22):

| Reading | Cases | Meaning |
| --- | ---: | --- |
| The Dispatch Log has a realised start | 9 | False positive |
| OTP Daily shows every scheduled origin departure in that hour | 20 | Probable false positive |
| No OTP Daily row (the blind stops) | 16 | Unknown |
| OTP Daily short of schedule | 2 | Probable real miss |

**Best-case precision is 38% (18/47) and the worst case is 4% (2/47).** The 95% bar is far
off. Escalations flagged with an Evidence conflict: **0**. Contradictions show up only in
the cross-check, never on the case. #510 is the first step toward showing them on the case.

**Since the fixes.** #504 (1.7.41, prediction-only readings) and #506 (1.7.45, DST clock
clamp, migration 165) landed on 4–5 November.

- **5 Nov is the only service day measured entirely after them.** The Dispatch Log realised
  605 of 606 trips, and the one trip without a reading opened no case. That is good, but
  it's one day with no cases in it, so it says nothing about precision.
- **4 Nov is a new false-positive class to diagnose before a measurement week counts.**
  Nine of the day's escalations sit in one 20-minute band, 16:00–16:19 UTC (10:00–10:19
  Central), on nine different routes. Every one has a Dispatch Log reading equal to the
  schedule ("schedule repeated", not a start). OTP Daily shows every origin departure in
  the hour for 5 of the 9, falls short for 1, and has no row for 3. This looks like a short TripUpdates gap that Decision coverage should have
  turned into Indeterminate trips instead of no-shows (Q7 and Q8). The trips just after the
  band (16:19–16:30) carry the same schedule-repeat reading and opened no case, which fits
  the feed recovering. It is not yet established whether #506 changes this.

**`gtfs-cancel-v1`** has never opened a case on dev (Q2). Its precision can't be measured,
so there's nothing to promote it on. One option is to leave it in Shadow detection and say
so; the other is to decide that explicit cancellations are promoted with the silent family.
That choice is a human decision.

**`spare-missed-v2`** has opened 35 cases, all escalated and all unreviewed: 28 late
arrivals, 5 late starts and 2 superseded. Five of them are since 27 October. The on-demand
bar is two service weeks, dispatcher agreement and no unresolved feed-health issue, and none
of that has started. The #471 review also found that Spare's lateness figure can't be
reproduced from the stored times. That question is open with the Spare data owner.

## 2. Promotion: fail

- `MissedTripDetectorPromotions` has **0 rows** (Q10).
- **Migration 134** is applied (the table exists). **Migration 137** is applied:
  `vw_MissedTrip`'s definition reads the promotion table. Migrations 135 (evidence conflict)
  and 136 (`AvailEvidenceLinks`) are applied too, because their objects exist.
- **The promotion form exists** *(corrected 2026-11-06)*. Admin → Missed-trip Detectors
  posts to `POST /missed-trip-detector-promotions` under `service-configuration.edit`.
  `decidePromotion` refuses anything below the bar, and the scorecard (#428) prefills a
  week. An earlier version of this document said there was no surface: that was wrong.
- **Sample size is a decision nobody has made.** At about 13 escalations a week, 95%
  precision means zero false positives (12/13 is 92.3%). A quiet week with 3 cases, all
  confirmed, would "pass" at 100%. *Resolved 2026-11-06*: the bar is now two weeks with at
  most two false alarms against runs watched (CONTEXT and the ADR-0036 amendment).

## 3. Review workflow: fail

- **Reviewer decisions:** 8 in `MonitoredMissedTrips` (4 confirmed, 4 Timely service) and 7
  rows in `MissedTripReviewHistory`, from 2026-08-06 to 2026-08-08 (Q11). One of the
  confirmations predates the history table. **None has been recorded since 8 August.**
- **Dispatch Log verifications:** 12, from 5–18 September, and none of them is on a case
  (Q12).
- **Who can review:** `compliance-review.review` is held through `compliance-analyst`
  (7 people) and `compliance-manager` (5 people), plus the system administrator's
  all-actions role (Q13). So the permission isn't the blocker: 12 people have it. What's
  missing is a named owner and a cadence.
- **Queue:** 47 v4 escalations, 9 v4 cases still watching and 35 Spare escalations, all
  unreviewed. There are also 1,773 legacy escalations (v2 and pre-v2) that are excluded by
  default and need no work.

## 4. Hand-off to assessment: pass in code, unproven live

The code path, read on `main` at `f1db6c2c`:

1. `actOnMissedTripCase` ([`lib/missedTripCase/index.ts`](../../functions-restapi/src/lib/missedTripCase/index.ts))
   writes the review and its `MissedTripReviewHistory` row, then classifies the case with
   the promotion windows.
2. A confirmation whose detector isn't promoted on that service date returns
   `shadow_detection`: the review is saved but no occurrence is created. Any other outcome,
   including a later non-confirmation, calls `recordOccurrence`
   ([`lib/occurrenceIntake/index.ts`](../../functions-restapi/src/lib/occurrenceIntake/index.ts))
   **in the same transaction**. An earlier occurrence is restated rather than duplicated, and
   a finalized month refuses the change.
3. `complianceCandidatesPoll` also raises candidates from cases with
   `counts_toward_assessment=1`. That flag needs three things: a confirmation, promotion on
   the service date, and no open Evidence conflict.
4. `MISSED_TRIPS_FR` is an occurrence standard. `assess.ts` aggregates the occurrence rows.

`missedTripCase.db.contract.test.ts` and `occurrenceIntake.db.contract.test.ts` prove the
path against a real database in CI. **Live, it has never run:**

- **Occurrences from a review:** 0. `MISSED_TRIPS_FR` has 4 rows, all `auto_candidate` /
  `candidate` / `undetermined` from 2026-08, left over from the August backfill (Q14).
- **Assessment periods:** two exist, 2026-01 and 2026-08, and both are `stale` (Q15).
  `ASSESSMENT_MONTH_BOUNDARY_ENABLED` is `False` on dev and on prod. No month after August
  has been assessed, so even a perfect missed-trip count would have no month to land in.

Two gaps in the path:

- **The last-trip-of-day $2,000 tier is never applied.** Migration 030 seeds
  `MISSED_TRIPS_FR` tier 2 with the `LAST_TRIP_OF_DAY` condition, but `recordOccurrence`
  from a review never sets `qualifier_code`. Only manual intake does. Every confirmed miss
  would be charged at $1,000.
- **One standard covers two contracts.** `MISSED_TRIPS_FR` is named "Fixed Route /
  Microtransit" and takes both GTFS and Spare cases. Whether that matches Attachment G is
  design-doc question Q8.

## 5. Evidence retention and audit: partial

| Item | State |
| --- | --- |
| Review history | Append-only `MissedTripReviewHistory`. A superseding review is a new row. **Good.** |
| Promotion history | Append-only by design (ADR-0036). Empty. |
| Avail evidence on cases (ADR-0035) | `AvailEvidenceLinks` holds 11,307 links: 142 exact (all partial-service records), 352 probable (351 entire-trip misses with no start time) and 10,813 unmatched (Q17). Avail never opens or closes a case. **Working as designed. It adds little, because entire-trip misses can't be placed on a trip.** |
| Evidence conflict | The column and the rule exist (migration 135). **It has never been set** (Q18). The nightly reconciliation doesn't yet raise one from the Dispatch Log or OTP Daily, which is what #510 starts on. |
| Case evidence snapshot | Spare cases carry `evidence_json` (35 of 35). **GTFS v4 cases mostly don't (4 of 182).** Their evidence is assembled at review time from `TripStartLog`, `GtfsTripOperationalEvidence` and `GtfsScheduledTrips` (`caseEvidence.ts`). No purge job exists for those tables, and the oldest rows are from 7 August and 5 September (Q20), so they are retained today by default, not by a policy. CONTEXT's "Retained missed-trip evidence" needs the cited evidence frozen at review time. |
| OTP Daily | `otpDailyFeedPoll` purges after **90 days**. If #510's departures are shown but not copied onto the case, they disappear before a dispute window could close. |

## 6. Data feeds: pass for detection, with known limits

Read from `KpiFeedHealth` at 06:09 UTC, which is overnight, so low counts are expected (Q16):

| Feed | Last success | State |
| --- | --- | --- |
| GTFS-RT TripUpdates | 2026-11-06 06:05 | Current |
| GTFS-RT VehiclePositions | 2026-11-06 06:05 | Current |
| GTFS static | 2026-11-05 09:00 | Current. Schedule version v65 since 2 Nov |
| Dispatch Log (`TripStartLog`) | Through service date 5 Nov, updated 05:06 | Current. 5 Nov had 605/606 realised |
| Avail OTP Daily | 2026-11-05 12:01, data through 4 Nov | Current (next-day by design) |
| Avail missed trips | 2026-11-06 03:04, data through 4 Nov | Current. Corroboration only |
| Avail Pullout | **Failing since 2026-11-04 16:55** (`SQL Error`) | Down. Avail's SQL login. Feeds GARAGE_DEPARTURE, not missed trips |
| Avail AVL | **Failing since 2026-11-04 16:55** | Down, same cause. Not a detection input |
| Spare requests and slots | 2026-11-06 06:02 | Polling. 0 rows overnight is expected |

Known limits that stay true whatever the feeds' health:

- **Avail's entire-trip misses have no start time**, so they can't be placed on a trip
  (1,989 of 1,989 in October).
- **Avail's stop detection is blind at about six origin stations.** Burnsville Center,
  Mystic Lake, Marschall Road, Apple Valley NB, Savage and MSP T1 account for 93% of its
  entire-trip misses, and OTP Daily has no row for those origin-hours either. That's why 16
  of the 47 open cases can't be checked.
- **The Dispatch Log reads GTFS-RT TripUpdates.** So the detector and its main check share a
  source, and a TripUpdates gap removes both at once (see 4 Nov).

## 7. Production: fail

From the prod REST app's settings, read 2026-11-06:

- **Enabled early (#446):** `gtfsMissedTripsPoll`, `tripStartLogMaterialize`,
  `tripStartActualsPoll`, `gtfsVehiclePositionsPoll`, `gtfsStopsSync` and
  `fixedRouteDeparturesPoll`. `GTFS_SILENT_NO_SHOW_ENABLED=True`. So prod is opening silent
  no-show cases.
- **Disabled (#426, until cutover):** `availMissedTripsPoll`, `otpDailyFeedPoll`,
  `spareMissedTripsIngest`, `spareMissedTripsEvaluate`, `complianceCandidatesPoll`,
  `assessmentPeriodOpen` and the rest of the list. On prod there's no Avail corroboration,
  no OTP Daily evidence (#510 would show nothing there), no Spare cases and no assessment
  months.
- **Prod's DB migration level: unknown from here.** `sql-mvta-prod-b0885v` has public
  network access **Disabled** (closed 2026-11-06), so it couldn't be read. Notes from
  earlier sessions record migrations 152 and 165 applied on prod. Nobody has checked prod
  against `SCHEMA_REQUIREMENTS` for 134–137. The schema-drift check on prod's
  Integrations & Data Health page is the place to read it.

## 8. Process and ownership: fail

| Needed | Exists? |
| --- | --- |
| An agreed definition of a missed trip for penalty purposes | **No.** Design-doc §12 Q1 (entire trip vs either end, and deadheads) is open. The `Full Trip Only=0` setting OnBoard sends to Avail is an engineering default, not a contract reading. CONTEXT's 30-minute Trip start rule is OnBoard's glossary, not a cited clause |
| The last-trip-of-day rule for fixed route and microtransit | **No.** §12 Q8 is open, and the code doesn't apply it (§4) |
| A named reviewer, and who holds Missed-trip review authority vs Service attribution | **No.** 12 people hold the permission and nobody owns it |
| Who signs a promotion, and on what minimum sample | **No** |
| A missed-trip review SOP | **No.** `plans/sop-drafts/` has none for missed trips |
| A written description of today's manual count | **No.** It isn't in the repo, so there's nothing to reconcile OnBoard against (the A0 step in the OTP work) |
| A questions-for-Rob document | **No.** OTP has [`otp-questions-for-rob-2026-11-01.md`](otp-questions-for-rob-2026-11-01.md). Missed trips needs the same |

The OTP work had the technical side finished before it went to Rob. Here both sides are
open, but the questions for Rob are the ones that can't be parallelised, so they should go
first.

## 9. Open PRs touching missed trips

| PR | What | Bearing |
| --- | --- | --- |
| #510 (1.7.52) | Show Avail OTP Daily departures at a case's first stop | Helps the reviewer, and starts on the contradiction evidence §1 needs. It doesn't raise an Evidence conflict or copy the evidence onto the case (§5). It does nothing on prod until `otpDailyFeedPoll` is on |
| #471 | Review of missed-trip evidence and detour wording (docs) | Items 1–6 merged in #472 and #473. The Spare lateness question is still open |
| #430 (1.7.56) | One freshness rule for every feed | Touches feed health, which ADR-0036 makes part of on-demand promotion |

---

## What's left, in order

Each step is marked **code**, **data** or **decision**. "Engineering" means an OnBoard build
session.

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 1 | Write the missed-trip questions for Rob, in the OTP format: definition (entire trip vs either end, deadheads, the 30-minute start rule's contract source), last-trip-of-day for both service types, one standard or two, minimum promotion sample, who reviews and who attributes, and how today's manual count is made | Decision (doc by engineering) | Ty, then Rob | Document merged and sent |
| 2 | Name the reviewer(s) and a cadence (for example, weekday mornings for the previous service day) | Decision | Ty / OCC manager | A name is in the SOP and the role is held |
| 3 | Work the backlog: 47 v4 escalations and 35 Spare. The pre-fix weeks won't pass, but every decision is a labelled example and tests the review screens | Data (human) | Named reviewer | 0 unreviewed escalations before the measurement week |
| 4 | Diagnose the 4 Nov 16:00–16:19 UTC cluster (9 schedule-repeat escalations in one band). Confirm whether Decision coverage should have made them Indeterminate, and whether #506 already fixes it | Code | Engineering | Explained, fixed if needed, with a test |
| 5 | Merge #510, then make the contradiction count: raise an Evidence conflict (or a recorded "departure observed") from the Dispatch Log and OTP Daily, and freeze the cited evidence onto the case at review | Code | Engineering | Contradicted cases show it on the case. Evidence survives OTP Daily's 90-day purge |
| 6 | Set `qualifier_code = LAST_TRIP_OF_DAY` when the case is the last scheduled trip of the service day, once step 1 says how it applies | Code | Engineering | A confirmed last trip raises a tier-2 occurrence |
| 7 | Measurement week: one complete Monday–Sunday service week after steps 4 and 5, with every case decided within the week | Data (human) | Named reviewer | Scorecard week shows precision ≥ 95% on the agreed minimum sample |
| 8 | Record the promotion for `gtfs_silent_no_show` (and decide `gtfs_cancellation`) with an effective service date. The first of a month is the natural choice | Decision | Rob signs, recorded on the existing promotion form | Row in `MissedTripDetectorPromotions` on dev and prod |
| 9 | Turn on the assessment month: `ASSESSMENT_MONTH_BOUNDARY_ENABLED`, and have assessment periods actually computed for the month the promotion starts | Data and decision | Ty | That month's period exists and isn't `stale` |
| 10 | Prod cutover for missed trips: enable `availMissedTripsPoll`, `otpDailyFeedPoll`, `complianceCandidatesPoll`, `assessmentPeriodOpen` (and Spare when step 12 is ready), and read prod's schema drift for 134–137 | Data (ops) | Ty | Prod health page shows those feeds current and no drift |
| 11 | Parallel run: one month of OnBoard's confirmed count beside the manual count, with differences explained | Data and decision | Reviewer, then Rob | Rob accepts and the manual count stops |
| 12 | On-demand separately: answer the Spare lateness question, then two service weeks, dispatcher agreement and no open feed-health issue | Decision, then data | Spare data owner, dispatch, reviewer | Its own promotion row |

Steps 1, 2, 4 and 5 can all start Monday 9 November in parallel. Step 3 needs step 2, and
step 7 needs steps 3–5.

## Earliest realistic date

- **Fixed route (GTFS silent no-show), the earliest possible:** count from service date
  **2026-12-01**. That needs a passing measurement week of 16–22 November, which in turn
  needs steps 2–5 finished in the week of 9 November and Rob's answers before the end of
  November. Every step would have to go right first time, and step 4 is an unexplained
  false-positive class, so treat this date as a stretch.
- **Fixed route, realistic: 2027-01-01**, the first month after a passing week in late
  November or early December, Rob's answers, prod cutover, and one month of parallel run
  (December) set against the manual count.
- **On-demand (Spare): not before 2027-02-01.** It needs the Spare data owner's answer, then
  two passing service weeks and dispatcher agreement. None of that has started, and nothing
  makes it date-bound.

Until then the honest position is that **today's manual count stays the system of
record**, and OnBoard is a review queue that nobody is working yet.

---

## Appendix: SQL run (dev, read-only)

All of it was run against `sql-mvta-dev-mvta-jx4471` / `sqldb-mvta-onboard-dev`, confirmed
by `@@SERVERNAME, DB_NAME()` at the top of each file, on 2026-11-06 between 06:07 and
06:15 UTC, with `sqlcmd --authentication-method=ActiveDirectoryAzCli -i <file>`. Prod's
settings came from `az functionapp config appsettings list` on `func-mvta-restapi-prod`,
filtered to `AzureWebJobs.*`, `*MISSED*`, `*SILENT*` and `ASSESSMENT_MONTH_BOUNDARY_ENABLED`.
Prod's DB wasn't queried because its public access is disabled.

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db, SYSUTCDATETIME() now_utc;
-- Q1 cases by detector version since 2026-10-27
SELECT detector_version, ISNULL(source_system,'gtfs') src, status, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx
FROM MonitoredMissedTrips WHERE service_date >= '20261027' GROUP BY detector_version, ISNULL(source_system,'gtfs'), status ORDER BY 1,2,3;
-- Q2 all-time by detector version
SELECT detector_version, ISNULL(source_system,'gtfs') src, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx FROM MonitoredMissedTrips GROUP BY detector_version, ISNULL(source_system,'gtfs') ORDER BY n DESC;
-- Q3 v4 per service date since 20261101, with Dispatch Log
SELECT m.service_date, COUNT(*) cases, SUM(CASE WHEN m.status='escalated' THEN 1 ELSE 0 END) escalated,
 SUM(CASE WHEN m.status='escalated' AND t.actual_start_at IS NOT NULL AND t.actual_start_at<>t.scheduled_start_at AND t.actuals_updated_at>=t.actual_start_at AND t.actual_start_at<=m.grace_deadline_at THEN 1 ELSE 0 END) esc_dl_realised_before_deadline,
 SUM(CASE WHEN m.evidence_conflict_at IS NOT NULL THEN 1 ELSE 0 END) conflicts
FROM MonitoredMissedTrips m LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
WHERE m.detector_version='gtfs-silent-v4' AND m.service_date>='20261101' GROUP BY m.service_date ORDER BY 1;
-- Q4 Dispatch Log coverage per day
SELECT service_date, COUNT(*) sched, SUM(CASE WHEN actual_start_at IS NOT NULL AND actual_start_at<>scheduled_start_at AND actuals_updated_at>=actual_start_at THEN 1 ELSE 0 END) realised
FROM TripStartLog WHERE service_date>='20261101' GROUP BY service_date ORDER BY 1;
-- Q5 open escalated / in-queue by detector
SELECT detector_version, status, validation_status, CASE WHEN evidence_conflict_at IS NULL THEN 0 ELSE 1 END conflict, COUNT(*) n
FROM MonitoredMissedTrips WHERE status IN ('escalated','open','watching') OR (validation_status='unreviewed' AND status<>'resolved')
GROUP BY detector_version, status, validation_status, CASE WHEN evidence_conflict_at IS NULL THEN 0 ELSE 1 END ORDER BY n DESC;
-- Q6 status vocabulary overall
SELECT status, validation_status, data_quality_status, COUNT(*) n FROM MonitoredMissedTrips GROUP BY status, validation_status, data_quality_status ORDER BY n DESC;
```

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db;
-- Q7 escalated v4 since 20261101 triangulated: Dispatch Log reading + OTP Daily at origin hour
WITH c AS (
 SELECT m.service_date, m.trip_id, m.route_id, m.grace_deadline_at, m.evidence_conflict_at, t.origin_stop_id, t.scheduled_start_at, t.actual_start_at, t.actuals_updated_at,
  DATEPART(HOUR, CAST(t.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h
 FROM MonitoredMissedTrips m LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
 WHERE m.detector_version='gtfs-silent-v4' AND m.status='escalated' AND m.service_date>='20261027')
SELECT c.service_date, c.route_id, c.trip_id, CONVERT(varchar(16),c.scheduled_start_at,120) sched,
 CASE WHEN c.actual_start_at IS NULL THEN 'none' WHEN c.actual_start_at=c.scheduled_start_at THEN 'sched-repeat' WHEN c.actuals_updated_at<c.actual_start_at THEN 'prediction'
      WHEN c.actual_start_at<=c.grace_deadline_at THEN 'realised<=deadline' ELSE 'realised>deadline' END dl,
 (SELECT SUM(o.actual_departures) FROM OtpDailyRouteStopHour o WHERE o.calendar_date=c.service_date AND CAST(o.route_id AS varchar(20))=c.route_id AND CAST(o.stop_id AS varchar(40))=c.origin_stop_id AND o.hour_of_day=c.h) otp_dep,
 (SELECT COUNT(*) FROM TripStartLog s WHERE s.service_date=c.service_date AND s.route_id=c.route_id AND s.origin_stop_id=c.origin_stop_id AND DATEPART(HOUR, CAST(s.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time')=c.h) sched_in_hour,
 CASE WHEN c.evidence_conflict_at IS NULL THEN 0 ELSE 1 END conflict
FROM c ORDER BY 1,2;
-- Q8 5 Nov: trips without a realised start, and whether a case exists
SELECT t.service_date, t.trip_id, t.route_id, CONVERT(varchar(16),t.scheduled_start_at,120) sched, t.actual_start_at, t.start_status,
 (SELECT COUNT(*) FROM MonitoredMissedTrips m WHERE m.service_date=t.service_date AND m.trip_id=t.trip_id) has_case
FROM TripStartLog t WHERE t.service_date IN ('20261104','20261105') AND NOT (t.actual_start_at IS NOT NULL AND t.actual_start_at<>t.scheduled_start_at AND t.actuals_updated_at>=t.actual_start_at);
-- Q9 latest v4 / any case created
SELECT MAX(first_seen_watching_at) last_case_seen, MAX(last_checked_at) last_checked FROM MonitoredMissedTrips WHERE ISNULL(source_system,'gtfs')='gtfs';
SELECT MAX(first_seen_watching_at) last_spare_seen, MAX(last_checked_at) spare_last_checked FROM MonitoredMissedTrips WHERE source_system='spare';
```

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db;
-- Q10 promotions
SELECT COUNT(*) promotions FROM MissedTripDetectorPromotions;
-- Q11 review history
SELECT validation_status, review_kind, COUNT(*) n, MIN(reviewed_at) first_at, MAX(reviewed_at) last_at FROM MissedTripReviewHistory GROUP BY validation_status, review_kind;
SELECT validation_status, COUNT(*) n, MIN(validated_at) mn, MAX(validated_at) mx FROM MonitoredMissedTrips WHERE validation_status<>'unreviewed' GROUP BY validation_status;
-- Q12 Dispatch Log verifications
SELECT observation, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx FROM TripStartVerifications GROUP BY observation;
SELECT COUNT(*) events FROM TripStartVerificationEvents;
-- Q13 who can do compliance-review.review (role actions + all_actions roles), and live grants
SELECT r.role_key, r.all_actions, (SELECT COUNT(*) FROM AccessRoleActions a WHERE a.role_key=r.role_key AND a.action_key='compliance-review.review') has_review_action,
 (SELECT COUNT(DISTINCT g.person_id) FROM AccessRoleGrants g WHERE g.role_key=r.role_key AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>SYSUTCDATETIME())) live_holders
FROM AccessRoles r WHERE r.archived_at IS NULL AND (r.all_actions=1 OR EXISTS (SELECT 1 FROM AccessRoleActions a WHERE a.role_key=r.role_key AND a.action_key='compliance-review.review'));
-- Q14 occurrences for missed trips
SELECT s.code, o.source, o.review_status, o.attribution, COUNT(*) n, MIN(o.service_month) mn, MAX(o.service_month) mx FROM ComplianceOccurrences o JOIN ContractorPerformanceStandards s ON s.id=o.standard_id GROUP BY s.code, o.source, o.review_status, o.attribution ORDER BY 1;
SELECT COUNT(*) mt_occ FROM ComplianceOccurrences WHERE source_ref LIKE 'MonitoredMissedTrips:%';
-- Q15 assessment periods
SELECT service_month, status, COUNT(*) n FROM AssessmentPeriods GROUP BY service_month, status ORDER BY service_month;
```

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db, SYSUTCDATETIME() now_utc;
-- Q16 feed health
SELECT feed_name, last_success_at, last_entity_count, source_timestamp_at, last_failure_at, LEFT(last_failure_reason,90) failure FROM KpiFeedHealth ORDER BY feed_name;
SELECT module, last_run_at FROM AppPollState ORDER BY module;
-- Q17 Avail evidence links and missed-trips feed recency
SELECT match_confidence, entire_trip_missed, resolution, CASE WHEN retracted_at IS NULL THEN 0 ELSE 1 END retracted, COUNT(*) n FROM AvailEvidenceLinks GROUP BY match_confidence, entire_trip_missed, resolution, CASE WHEN retracted_at IS NULL THEN 0 ELSE 1 END ORDER BY n DESC;
SELECT MAX(calendar_date) last_date, MAX(ingested_at) last_ingest FROM AvailMissedTripsRouteStopDay;
SELECT MAX(calendar_date) otp_daily_last_date FROM OtpDailyRouteStopHour;
SELECT MAX(service_date) dl_last_date, MAX(actuals_updated_at) dl_last_update FROM TripStartLog;
-- Q18 evidence retention on cases
SELECT detector_version, COUNT(*) n, SUM(CASE WHEN evidence_json IS NULL THEN 0 ELSE 1 END) with_evidence, SUM(CASE WHEN evidence_conflict_at IS NULL THEN 0 ELSE 1 END) conflicts FROM MonitoredMissedTrips WHERE ISNULL(data_quality_status,'')<>'legacy_unverified' GROUP BY detector_version;
-- Q19 spare cases since 20261027
SELECT service_date, status, validation_status, reason_code, detection_type FROM MonitoredMissedTrips WHERE source_system='spare' AND service_date>='20261027' ORDER BY service_date;
SELECT detection_type, COUNT(*) n FROM MonitoredMissedTrips WHERE source_system='spare' GROUP BY detection_type;
```

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db;
-- Q20 retention of the sources a GTFS case's evidence is read from at review time
SELECT 'GtfsTripOperationalEvidence' src, MIN(service_date) oldest, MAX(service_date) newest, COUNT(*) n FROM GtfsTripOperationalEvidence
UNION ALL SELECT 'TripStartLog', MIN(service_date), MAX(service_date), COUNT(*) FROM TripStartLog
UNION ALL SELECT 'OtpDailyRouteStopHour', MIN(calendar_date), MAX(calendar_date), COUNT(*) FROM OtpDailyRouteStopHour;
SELECT SUM(CASE WHEN trip_id LIKE '%-v64' THEN 1 ELSE 0 END) v64_trips, SUM(CASE WHEN trip_id LIKE '%-v65' THEN 1 ELSE 0 END) v65_trips, COUNT(*) n FROM GtfsScheduledTrips;
-- Q21 v4 cases whose trip is no longer in the static schedule
SELECT COUNT(*) v4_cases, SUM(CASE WHEN st.trip_id IS NULL THEN 1 ELSE 0 END) trip_gone_from_schedule FROM MonitoredMissedTrips m LEFT JOIN GtfsScheduledTrips st ON st.trip_id=m.trip_id WHERE m.detector_version='gtfs-silent-v4';
```

```sql
SET NOCOUNT ON;
SELECT @@SERVERNAME srv, DB_NAME() db;
-- Q22 all open escalated v4 cases, triangulated (Dispatch Log realised start; OTP Daily origin-hour departures vs scheduled)
WITH c AS (
 SELECT m.service_date, m.trip_id, m.route_id, m.grace_deadline_at, t.origin_stop_id, t.scheduled_start_at, t.actual_start_at, t.actuals_updated_at,
  DATEPART(HOUR, CAST(t.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h
 FROM MonitoredMissedTrips m LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
 WHERE m.detector_version='gtfs-silent-v4' AND m.status='escalated' AND m.validation_status='unreviewed'),
x AS (SELECT c.*,
 CASE WHEN c.actual_start_at IS NOT NULL AND c.actual_start_at<>c.scheduled_start_at AND c.actuals_updated_at>=c.actual_start_at THEN 1 ELSE 0 END dl_realised,
 (SELECT SUM(o.actual_departures) FROM OtpDailyRouteStopHour o WHERE o.calendar_date=c.service_date AND CAST(o.route_id AS varchar(20))=c.route_id AND CAST(o.stop_id AS varchar(40))=c.origin_stop_id AND o.hour_of_day=c.h) otp_dep,
 (SELECT COUNT(*) FROM TripStartLog s WHERE s.service_date=c.service_date AND s.route_id=c.route_id AND s.origin_stop_id=c.origin_stop_id AND DATEPART(HOUR, CAST(s.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time')=c.h) sched_in_hour
 FROM c)
SELECT CASE WHEN dl_realised=1 THEN '1 Dispatch Log realised start' WHEN otp_dep>=sched_in_hour THEN '2 OTP Daily: every origin departure in the hour' WHEN otp_dep IS NULL THEN '3 no OTP Daily row (unknown)' ELSE '4 OTP Daily short (probable real miss)' END reading,
 COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx FROM x
GROUP BY CASE WHEN dl_realised=1 THEN '1 Dispatch Log realised start' WHEN otp_dep>=sched_in_hour THEN '2 OTP Daily: every origin departure in the hour' WHEN otp_dep IS NULL THEN '3 no OTP Daily row (unknown)' ELSE '4 OTP Daily short (probable real miss)' END ORDER BY 1;
-- Q23 scorecard-style weekly counts for v4 (cases opened, escalated, reviewed)
SELECT DATEADD(DAY, -((DATEPART(WEEKDAY, CONVERT(date,service_date)) + @@DATEFIRST - 2) % 7), CONVERT(date,service_date)) week_monday,
 COUNT(*) cases, SUM(CASE WHEN status='escalated' THEN 1 ELSE 0 END) escalated, SUM(CASE WHEN validation_status<>'unreviewed' THEN 1 ELSE 0 END) reviewed
FROM MonitoredMissedTrips WHERE detector_version='gtfs-silent-v4'
GROUP BY DATEADD(DAY, -((DATEPART(WEEKDAY, CONVERT(date,service_date)) + @@DATEFIRST - 2) % 7), CONVERT(date,service_date)) ORDER BY 1;
```
