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
| 0.7 | **Split the standard** (Q3): `MISSED_TRIPS_FR` becomes fixed route only, and a new microtransit standard takes the Spare cases with its own tiers. Intake routes by `source_system`, and the resolver registry, assessment and Performance Standards admin all learn the new code. The 4 stale August candidates are re-pointed or dismissed. Needs a migration | Code | Engineering | A confirmed Spare case raises a microtransit occurrence, and a GTFS case a fixed-route one |
| 0.8 | **Split the three authorities** (Q8): the specialist records the outcome (`compliance-review.review`); a manager records attribution (new action, for example `compliance-review.attribute`); the COO decides excusable (new action, or `performance-assessment.decide`). A confirmed case's occurrence stays `undetermined`, so it doesn't count, until a manager attributes it. **Numbered steps in the PR: register the new action(s), then grant them to the named people (F7)** | Code | Engineering, then Ty for the grants | The reviewer can't set attribution, and a manager can't decide excusable |
| 0.6 | **A promotion form** on Admin → Missed-trip Detectors. It records the family, effective service date, promote or demote, reason, and precision and sample filled in from the scorecard, with the signed-in person as the decider. This replaces a hand-typed SQL insert, which nobody but the owner can run anyway | Code | Engineering | A promotion row can be recorded from the console, and the audit shows who recorded it |

## Phase 1: backlog and measurement (16 November to 6 December)

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 1.1 | **Work the backlog** on dev: 47 v4 escalations and 9 watching. Decide the 35 Spare cases too, because they're labelled examples for Phase 5 | Data (human) | Reviewer | 0 unreviewed escalations |
| 1.2 | **Measurement period**: two complete Monday–Sunday weeks after 0.3 and 0.4 are live. Target 16–29 November, with 23 November – 6 December as the fallback. Every escalation is decided within the period | Data (human) | Reviewer | It meets the bar under "Proposed promotion bar" (at most 2 false alarms, and ≥ 95% if there are 20+ cases) |
| 1.3 | If the week fails, **diagnose the false positives** and repeat 1.2 the following week. Each repeat moves the target month on by one | Code, data | Engineering, reviewer | |
| 1.4 | **Last-trip qualifier** (Q2 answered): a confirmed case on the **last trip of its block** on that service date (the block's final scheduled trip before return to the garage, from `TripStartLog` / `GtfsScheduledTrips`) raises a `LAST_TRIP_OF_DAY` occurrence (tier 2, $2,000). For microtransit, add it once F4 says what a duty's last trip is | Code | Engineering | A contract test proves the tier-2 occurrence on a block's last trip and tier 1 on its other trips |

## Phase 2: promotion (by 30 November for December, or by 31 December for January)

| # | Step | Kind | Owner | Done when |
| --- | --- | --- | --- | --- |
| 2.1 | Record the promotion of `gtfs_silent_no_show`, effective the **first of the next month**, with the scorecard's precision and sample and the decider named | Decision | Rob signs, Ty records (0.6) | Row in `MissedTripDetectorPromotions` |
| 2.2 | Promote `gtfs_cancellation` on the same date, with the reason "promoted with the silent no-show family; no cancellation has appeared in MVTA's feed" (decided by Q6) | Data | Same as 2.1 | Its own row |
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

## Answers received, 2026-11-06

Ty answered all eight questions, taking Q4–Q7 from the context given with each.

| Q | Answer | Effect |
| --- | --- | --- |
| 1 Definition | The contract defines a missed trip as "a scheduled trip not operated as planned due to staffing, vehicle, or operational issues". Attachment G charges "each time a scheduled fixed route or microtransit trip is missed due to contractor error, including late pullouts, operator no-shows" | **Contractor error is the gate**, which matches Service attribution. **The contract names no 30-minute threshold.** That rule is OnBoard's own, the same way 2/5/10/60 turned out to be Avail's defaults for OTP. See F1–F3 |
| 1 Deadheads | **Don't count.** MVTA doesn't track deadheads closely enough to tell whether the operator followed standard routing | Already true: OnBoard asks Avail for `Include Deadheads=0`, and the detector reads only revenue trips |
| 2 Last trip | **The last trip of the block** (the assigned work) at the end of the day, before the operator and vehicle return to the garage. The point is that a rider isn't stranded. **It includes microtransit** | Per block per service date, not per route or agency. The review path must set `LAST_TRIP_OF_DAY` (new step 1.4). For microtransit the equivalent unit of work has to be agreed (F4) |
| 3 One standard or two | **Two standards, one per service mode** | `MISSED_TRIPS_FR` today is "Fixed Route / Microtransit" and takes both. **It has to be split** (new step 0.7) |
| 4 Manual count | **MVTA staff count from Avail** | The parallel month compares against an Avail-based count. Avail's entire-trip misses are at least 78% contradicted by a recorded start (2026-11-04 research), so if the count uses that report unfiltered, the two counts **will** differ, and the difference is Avail's stop detection, not OnBoard. See F5 |
| 5 Minimum sample | **"We would rarely see 20 cases of missed trips"** | The case-count bar doesn't fit. A proposed replacement, measured against the trips the detector watched, is below and needs a yes |
| 6 Explicit cancellations | **Promote them with the no-show detector** | Step 2.2 is decided: `gtfs_cancellation` is promoted on the same date as `gtfs_silent_no_show` |
| 7 Parallel-run standard | **Every difference explained** | Totals may differ, but every trip on one list and not the other needs a written reason. Any unexplained trip holds the switch (4.1) |
| 8 Who decides what | **A transportation specialist reviews, managers decide attribution, and the COO decides whether it is excusable. All are MVTA staff** | Today one action, `compliance-review.review`, covers review, attribution and occurrence edits, and the reviewer sets attribution in the same act as the outcome. **The three authorities have to be split** (new step 0.8). Who signs a promotion is still unstated (F6) |

### Proposed promotion bar, replacing a case count (needs a yes)

Real missed trips are rare, so a week will rarely hold 20 genuine cases. The bar should
measure **false alarms against the trips the detector watched**, not precision on a handful
of cases:

> **Two complete service weeks, with every escalation reviewed, and no more than 2
> false alarms in total**: about 1 in 4,000 trips at roughly 4,200 trips a week. If the
> two weeks hold 20 or more cases, precision must also be at least 95%.

On today's numbers that is demanding. The week of 2 November had 13 escalations and
**nothing suggests more than 2 of them were real**, so the detector has to get much
quieter before it passes. That is the intent. CONTEXT's Shadow detection entry and ADR-0036
say "one complete service week at 95%", so accepting this means **amending both**. That's a
docs change in the promotion form's PR (0.6). The scorecard needs a "false alarms per
1,000 trips watched" column to show it.

### Follow-up questions the answers raise

- **F1. Is a late trip a missed trip, and from how late?** The definition says "not
  operated as planned", and the charge names "late pullouts". OnBoard counts a start more
  than 30 minutes late at the first public stop. Is that the threshold MVTA wants, or
  another number? Who owns it?
- **F2. Late pullouts are charged twice.** A late pullout is already a `GARAGE_DEPARTURE`
  occurrence. When it also makes the block's first trips miss, does the contractor pay
  under both standards, or only one?
- **F3. Partial service.** A trip that ran but skipped stops, for example a short-turn or
  starting mid-route, is "not operated as planned". Does it count as missed? OnBoard keeps
  it apart today as a Partial-service failure.
- **F4. Microtransit units.** What is one missed microtransit trip: a passenger request
  picked up late, a late drop-off (the on-demand agreement already makes a drop-off 30+
  minutes late a missed trip), or a slot not run? What is the "last trip of the block"
  for a Spare duty? Are the amounts the same $1,000 / $2,000?
- **F5. Which Avail report**, and what did it give for September and October? Does the
  specialist filter Avail's entire-trip misses by hand (Burnsville Center alone produced
  776 in four weeks with no departure detection at all)?
- **F6. Who signs a promotion**: the COO, a manager, or the specialist's manager?
- **F7. Names to grant.** Which people hold the specialist, manager and COO roles, so the
  grants in 0.8 can be checked?

---

## Questions for Rob (as sent)

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
| by Fri 13 Nov | 0.7 (split standard) and 0.8 (split authorities) merged, and grants made |
| 16–29 Nov | Measurement period (two weeks) |
| by Mon 30 Nov | Answers to F1–F6. Promotion recorded, effective 2026-12-01 for the parallel run (Shadow detection already blocks counting, so promotion is what lets OnBoard's figure exist) |
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
