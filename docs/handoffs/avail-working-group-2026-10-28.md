# Avail Working Group - 28 Oct 2026

What OnBoard pulls, with what parameters, and where the three figures now stand.

## 1. What we pull

Two independent Avail360 endpoints, polled on separate timers. Neither is
derived from the other, so they work as a cross-check.

| | Monthly feed | Daily feed |
|---|---|---|
| Operation | `OtpByRouteStopDayAgg/v1/MVTA` | `OtpByRouteStopDayHour/v1/MVTA` |
| Grain | route x stop x day-of-week | route x stop x hour |
| Date arguments | one date; Avail aggregates the containing month | explicit `start` / `end` |
| Used for | the stored compliance figure | cross-check only |
| Poll | daily 03:00 UTC, current month + prior two | daily |

Historical months outside that three-month window are only fetched on an
explicit backfill request, one month at a time.

We also pull `MissedTripsByRouteStopDay/v1/MVTA`, which is not part of the OTP
figure.

## 2. Thresholds we send

Both OTP operations take the same seven positional parameters:

`{Early Threshold}/{Late Threshold}/{Early Outlier}/{Late Outlier}/{Show Missed Stops}/{Include Outliers}/{Show Detours}`

As of 27 Oct 2026 we send **`2/5/10/60/0/1/1`**:

| Parameter | Value | Source |
|---|---|---|
| Early threshold | 2 min | MVTA's configured BI default, confirmed by Avail 27 Oct |
| Late threshold | 5 min | same |
| Early outlier | 10 min | same |
| Late outlier | 60 min | same |
| Show missed stops | 0 | |
| Include outliers | 1 | **open question - see below** |
| Show detours | 1 | |

Before 27 Oct we sent `1/5/15/30/0/1/1`. The early threshold of 1 minute was
wrong: it counted a departure 1-2 minutes early as early, where MVTA's own
standard counts it on time. We were measuring the agency against a stricter
rule than the one it is held to. The outlier values were copied from the
example in Avail's API specification during an earlier investigation and never
aligned to MVTA's configuration.

Correcting them moved the agency September figure from 80.18% to 81.22%, and
August from 83.62% to 85.07%.

## 3. Where the figures stand

Two separate defects were distorting our figures. Both are now fixed.

1. **Ours:** we sent an early threshold of 1 minute against MVTA's configured
   2. Corrected 27 Oct.
2. **Avail's:** the monthly aggregate returned a 31-day span for a 30-day
   month. Fixed on Avail's backend, live between 04:24 and 17:58 UTC on 28 Oct.

Effect of the month-boundary fix alone, re-polled 28 Oct 17:58 UTC:

| Month | Departures before | after | change |
|---|---|---|---|
| 202608 | 65,278 | 62,748 | -3.9% |
| 202609 | 65,158 | 62,538 | -4.0% |

About one service day in each, as expected. The percentages barely moved
(Aug 85.07 -> 85.30, Sep 81.22 -> 81.20), so the surplus day performed at
roughly the month average - the threshold correction was the real mover, the
date correction was a counting error.

September 2026 against Avail's own BI pull of *On-time Departure Performance
by Route*:

| Route | OnBoard | Avail BI | Gap |
|---|---|---|---|
| 420 | 89.17 | 89.2 | 0.03 |
| 465 | 66.33 | 66.4 | 0.07 |
| 475 | 56.79 | 56.9 | 0.11 |
| 495 | 80.81 | 80.9 | 0.09 |
| **Agency** | **81.20** | **81.3** | **0.10** |

Route 465 now returns **4,045 departures** - exactly the BI report's count,
against 4,271 before. The departure-count discrepancy is fully resolved.

The Avail API and the Avail BI report now reconcile to within 0.11 points on
every route tested. They were never inconsistent with each other; the gap was
our threshold error plus the date-span defect.

The figure that stands apart is MVTA's own circulated 73.4% (and 51.8% for
route 465). Establishing how it was produced is an OCC question, not an Avail
one. Step A0 of our validation plan - reconciling the weekly-CSV spreadsheet
against the canned monthly report before either is treated as a baseline -
appears not to have been completed.

## 4. For Avail

1. **Thank you for the month-boundary fix** - it resolved the departure-count
   gap exactly. For the record, please confirm the time it went live so we can
   mark which of our stored months predate it.

2. **Does the BI report exclude outlying departures from its denominator?**
   We send `Include Outliers = 1`. With the two known defects fixed the
   residual gap is now ~0.1 points, so this is a precision question rather
   than an open problem.

3. **Default thresholds when unspecified** - you offered to confirm whether
   the API defaults to Early = 1 / Late = 5. We now send all four explicitly,
   so this is for the record.

## 5. Consequence for MVTA

Every stored monthly figure was built from a date span one day too wide and
from the wrong early threshold. Both are now corrected at the source.
All five months have now been re-pulled clean (May and June via the historical
backfill, 28 Oct 19:27-19:28 UTC).

| Month | Before | After | Move |
|---|---|---|---|
| 202605 | 85.80 | **87.56** | +1.76 |
| 202606 | 84.42 | **85.92** | +1.50 |
| 202608 | 83.62 | **85.30** | +1.68 |
| 202609 | 80.18 | **81.20** | +1.02 |

**The Tier A acceptance criterion is broken as written.** It requires that no
month land in a different performance tier. Against the corrected figures, two
of the three decision months cross the 85% "meets" boundary: June
(84.42 -> 85.92) and August (83.62 -> 85.30). May was already above it. All
three decision months now read as "meets" where two previously did not.

This is not a reason to distrust the corrected figures - they are the ones that
reconcile with Avail's own BI report to within 0.11 points. It means the
criterion was written against measurements taken with the wrong early threshold
and a one-day-too-wide window, and has to be restated before the comparison is
run. Otherwise it fails on a technicality rather than on substance.

The Tier A acceptance criterion - agreement within 0.5 points across three
service months with no month changing performance tier - was written against
the old figures. August has already crossed the 85% "meets" boundary
(83.62 -> 85.07) and June is likely to follow. That criterion needs restating
before the comparison is run, or it will fail for the wrong reason.
