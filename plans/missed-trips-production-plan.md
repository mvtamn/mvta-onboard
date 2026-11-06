# Missed trips into production: plan

**Date:** 2026-11-06. **Status:** proposed. It starts from the gates in
[`docs/handoffs/missed-trips-system-of-record-status-2026-11-06.md`](../docs/handoffs/missed-trips-system-of-record-status-2026-11-06.md)
and fits into the environment cutover in `plans/production-environment-plan.md` (PR #406).

**Goal.** For January 2027, the contractor's assessed missed trips are OnBoard's Confirmed
missed trips, read on production, and the manual count stops. On-demand follows separately,
no earlier than February 2027.

---

## The fact that shapes the order

Production's database is **recopied from dev at cutover** (environment plan, decision 2,
step 22). That has three consequences:

- **The work done on dev before cutover carries over to prod.** Reviews, review history,
  promotion rows and assessment periods all move with the copy, so the reviewer can start
  on dev now without waiting for production.
- **The cases prod opens before cutover are thrown away.** Prod has run
  `gtfsMissedTripsPoll` since 2026-10-22 (#446), but those rows are overwritten by the copy.
  Nobody should review on prod before cutover.
- **After cutover dev keeps polling (decision 4), so two queues exist.** From that moment
  only prod's queue counts. The SOP has to say so, and dev's Missed Trips page should say
  it isn't the record.

So the plan runs on dev until cutover, then moves to prod in one step. If cutover lands in
the middle of a measurement week, that week is measured on whichever side holds all seven
days, and that is normally dev.

---

## Phase 0: start now (week of 9 November)

These four tracks are independent and run in parallel.

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 0.1 | Send the **questions for Rob** below | Decision | Ty, then Rob | Sent, with a date for answers |
| 0.2 | **Name the reviewer** and a cadence: each weekday morning, decide the previous service day's cases. Grant `compliance-review.review` if they don't hold it already | Decision | Ty / OCC manager | Name agreed, grant checked on dev |
| 0.3 | **Diagnose the 4 Nov cluster**: 9 escalations between 16:00 and 16:19 UTC, every one a Dispatch Log schedule repeat. Was it a TripUpdates gap that Decision coverage should have turned into Indeterminate? Does #506 already cover it? | Code | Engineering | Explained, fixed if needed, with a regression test |
| 0.4 | **Land #510**. It currently conflicts with main, probably a version race, so rebase and renumber it. Then make the contradiction count: when the Dispatch Log or OTP Daily shows the trip leaving, the nightly reconciliation records an **Evidence conflict** on the case. It never closes a case (ADR-0035) | Code | Engineering | A contradicted case shows the conflict, and the scorecard counts it |
| 0.5 | **Freeze the evidence at review.** When a reviewer decides a case, write the readings they saw (Dispatch Log, vehicle, block, origin stop, OTP Daily departures) into the case's `evidence_json`. Today GTFS evidence is read live, and OTP Daily is purged after 90 days. Also show when the evidence read failed (review item 8, #471) | Code | Engineering | A reviewed case still shows its evidence after the source rows are gone |
| 0.6 | **A promotion form** on Admin → Missed-trip Detectors. It records the family, effective service date, promote or demote, reason, and precision and sample filled in from the scorecard, with the signed-in person as the decider. This replaces a hand-typed SQL insert, which nobody but the owner can run anyway | Code | Engineering | A promotion row can be recorded from the console, and the audit shows who recorded it |

## Phase 1: backlog and measurement (16 November to 6 December)

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 1.1 | **Work the backlog** on dev: 47 v4 escalations and 9 watching. Decide the 35 Spare cases too, because they're labelled examples for Phase 5 | Data (human) | Reviewer | 0 unreviewed escalations |
| 1.2 | **Measurement week**: the first complete Monday–Sunday after 0.3 and 0.4 are live. Target 16–22 November, with 23–29 November as the fallback. Every case is decided within the week | Data (human) | Reviewer | Scorecard week shows ≥ 95% precision on at least the minimum sample (Q5) |
| 1.3 | If the week fails, **diagnose the false positives** and repeat 1.2 the following week. Each repeat moves the target month on by one | Code, data | Engineering, reviewer | |
| 1.4 | **Last-trip-of-day qualifier**, once Q2 is answered: a confirmed case on the final scheduled trip of the service day raises a `LAST_TRIP_OF_DAY` occurrence (tier 2, $2,000) | Code | Engineering | A contract test proves the tier-2 occurrence |

## Phase 2: promotion (by 30 November for December, or by 31 December for January)

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 2.1 | Record the promotion of `gtfs_silent_no_show`, effective the **first of the next month**, with the scorecard's precision and sample and the decider named | Decision | Rob signs, Ty records (0.6) | Row in `MissedTripDetectorPromotions` |
| 2.2 | Decide `gtfs_cancellation`: either promote it with the silent family, or leave it in Shadow detection and say so. It has opened no cases, so there's nothing to measure (Q6) | Decision | Rob | Recorded either way |
| 2.3 | Turn on the assessment month: `ASSESSMENT_MONTH_BOUNDARY_ENABLED=true` and `assessmentPeriodOpen`, and catch up the stale periods | Data (ops) | Ty | The promoted month's period exists and is current |

## Phase 3: cutover (on the environment plan's date)

Missed trips add these items to the environment plan's steps 21–23:

| # | Step | Kind | Owner |
| --- | --- | --- | --- |
| 3.1 | Before step 21: the reviewer finishes the previous day's cases on dev, so nothing is half-decided at the copy | Data (human) | Reviewer |
| 3.2 | Step 22: after the copy, prod's schema drift reads clear, including 134–137. `MissedTripDetectorPromotions` and `MissedTripReviewHistory` row counts match dev | Data | Ty |
| 3.3 | Step 23: enable prod's missed-trip timers, which `restApiTimersEnabled=true` does in one go: `availMissedTripsPoll`, `otpDailyFeedPoll`, `spareMissedTripsIngest`, `spareMissedTripsEvaluate`, `complianceCandidatesPoll` and `assessmentPeriodOpen`. `gtfsMissedTripsPoll` is already on | Data (ops) | Ty |
| 3.4 | Dev's Missed Trips page shows "Not the record: review on production" (decision 4 already silences dev's Teams and rider sends) | Code | Engineering |
| 3.5 | The first morning after: Integrations & Data Health shows TripUpdates, VehiclePositions, the Dispatch Log, OTP Daily and Avail missed trips current on prod. The reviewer decides the first prod day | Data | Ty, reviewer |

**If cutover hasn't happened by the promoted month**, the month is assessed on dev and the
copy carries it over. Nothing about the record depends on cutover. It only has to be done
before the contractor sees a report from `onboard.mvta.com`.

## Phase 4: parallel month, then switch (December 2026, then January 2027)

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 4.1 | **December parallel run**: the manual count runs as today, and OnBoard's confirmed count runs beside it. Every difference is explained per trip | Data (human) | Reviewer, Rob | Differences explained. Rob accepts under the agreed standard (Q7) |
| 4.2 | **The SOP**: daily review, attribution, what to do with an Evidence conflict, the promotion and demotion rule, and where to review (prod only after cutover) | Doc | Engineering drafts, OCC manager owns | SOP in the library |
| 4.3 | **Switch**: from service date 2027-01-01 the January assessment takes `MISSED_TRIPS_FR` from OnBoard, and the manual count stops | Decision | Rob | Recorded in the assessment's notes |

**The stretch case.** If 1.2 passes on 16–22 November and Rob answers in November, the
promotion can be effective 2026-12-01 and December becomes the first counted month. The
cost is that there's no parallel month. I don't recommend it: a missed trip costs the
contractor $1,000 each, so the first month OnBoard counts should already have been compared
once against the manual count.

## Phase 5: on-demand (no earlier than February 2027)

1. The Spare data owner answers the lateness question (review item 7, #471). Until then a
   late-arrival case can't be checked against its own stored times.
2. On-demand's own bar, per CONTEXT: **two** complete service weeks at ≥ 95%, dispatcher
   agreement, and no unresolved feed-health issue on Spare.
3. Then its own promotion row for `spare`, a parallel month, and a switch, just like fixed
   route.

---

## Questions for Rob

The first four can change what is counted, so they go first.

1. **What is a missed trip under Attachment G?** OnBoard counts a run that didn't start, or
   started more than 30 minutes after its published start, at its first public stop. Is
   that the contract's definition? Does a trip that missed its last stops count (Avail's
   "either end")? Do deadheads count? Which clause is the source?
2. **Last trip of the day.** Attachment G charges $2,000 for the last trip of the service
   day. Does "last trip" mean last per route, per block, or for the whole agency, and does
   it apply to microtransit?
3. **One standard or two.** `MISSED_TRIPS_FR` is "Fixed Route / Microtransit" and takes
   both. Is that how the contract assesses them, or are they separate lines?
4. **How is the manual count made today?** Who keeps it, from what source, and what did
   it give for September and October? Without it there's nothing to compare against in 4.1.
5. **The promotion bar.** It's 95% precision over a complete service week. What is the
   minimum number of cases for a week to count? A week with 3 cases proves nothing.
6. **Explicit cancellations** have never appeared in MVTA's feed. Promote them with the
   silent detector, or keep them in Shadow detection until one is seen?
7. **The parallel-run standard.** In the parallel month, how far apart can OnBoard and the
   manual count be before the switch is held back: zero, or explained trip by trip?
8. **Who decides what.** The reviewer decides what happened. Who decides attribution
   (contractor, excusable, MVTA-directed), and who signs a promotion?

---

## Calendar, if nothing slips

| Date | Milestone |
| --- | --- |
| Mon 9 Nov | Questions sent, reviewer named, 0.3–0.6 started |
| Fri 13 Nov | 0.3 and 0.4 live on dev |
| Sun 15 Nov | Backlog cleared |
| 16–22 Nov | Measurement week |
| by Fri 27 Nov | Rob's answers. Promotion recorded, effective 2026-12-01 for the parallel run (Shadow detection already blocks counting, so promotion is what lets OnBoard's figure exist) |
| December | Parallel month. Cutover whenever the environment plan sets it |
| early January | Rob accepts December's comparison |
| 2027-01-01 | OnBoard is the system of record for fixed-route missed trips |
| early February | The January assessment is the first one issued on OnBoard's count |

**About the promotion date.** ADR-0036 makes a promotion count a case toward the
assessment. To run the December parallel month with a real OnBoard figure, the promotion
has to be effective 2026-12-01, which means OnBoard's December figure exists in the
assessment. So December's assessment has to be marked as **parallel** and not issued on
OnBoard's count (4.3 is the switch). The alternative is to compute December's comparison
from the scorecard and the confirmed list without promoting until 2027-01-01. That's
cleaner for the record, but it leaves the hand-off path untried until January. The
recommendation is to promote 2026-12-01 and not issue December from OnBoard.
