# Prediction Accuracy: Evaluation

Status: increment 1 built 2026-10-16 (v1.5.332, ADR 0041); increments 2–4
open. Written 2026-10-16 against main `68057419`
(v1.5.330), with live samples of MVTA's GTFS-realtime feeds taken 16:27–16:28
UTC that day.

Question: can OnBoard measure how accurate the arrival predictions riders see
are, per route and as one agency figure, the way Swiftly's Sep 1–20 comparison
did (490 at 49%, 470 at 79%)?

**Answer: yes, measured forward from the day capture starts, using the same
definition Swiftly and Transit publish, at negligible cost.** No history of
predictions exists anywhere in OnBoard, so there is nothing to backfill.

---

## 1. What "accuracy like Swiftly" means

Swiftly and Transit publish one definition, the **ETA Accuracy Benchmark**
([TransitApp/ETA-Accuracy-Benchmark](https://github.com/TransitApp/ETA-Accuracy-Benchmark/)).
OnBoard should adopt it exactly, so its figures are comparable with Swiftly's
and with any agency using the benchmark.

A prediction is the ETA for one trip at one stop, sampled at one moment. Its
**bucket** is the time from that moment to when the bus actually reached the
stop. Its **variance** is predicted minus actual. It is accurate when the
variance falls inside the bucket's window, with both limits inclusive:

| Time to actual arrival | Early limit | Late limit |
|---|---|---|
| 0–3 min | 30 s early | 1.5 min late |
| 3–6 min | 1 min early | 2.5 min late |
| 6–10 min | 1 min early | 3.5 min late |
| 10–15 min | 1.5 min early | 4.5 min late |

Each bucket's accuracy is accurate predictions divided by predictions in that
bucket. The **overall figure is the straight average of the four bucket
percentages**, not a pooled share. Early predictions are held tighter than
late ones, because a rider who arrives for an early ETA and finds the bus
already gone has missed it.

A companion **ETA Completeness Benchmark**
([Swiftly](https://www.goswift.ly/blog/eta-completeness-benchmark)) counts the
share of scheduled trip-stops that had an assigned vehicle and at least one
prediction 0–15 minutes out, with cancelled trips and skipped stops counting
as complete. It catches "ghost buses", trips that showed a schedule-only ETA
and never came. It is worth computing beside accuracy, because a route can
score well on accuracy simply by not predicting the hard trips.

The benchmark leaves three things open, and OnBoard has to decide them:

- **Sampling cadence.** Not specified. One sample per minute per trip-stop is
  the common practice and is proposed here.
- **Actual arrival.** "A separate dataset of actual arrivals." Section 3
  covers where OnBoard gets one.
- **Route and agency totals.** Only "the routes in the sample" is defined.
  Proposed: a route figure is the benchmark computed over that route's
  predictions, and the agency figure is the benchmark computed over all
  predictions, never an average of route figures.

## 2. What the live feeds hold

The rider apps (Transit, Google) read MVTA's GTFS-realtime TripUpdates feed,
which Avail produces and `srv.mvta.com` publishes. Measuring that feed measures
what riders see.

Sampled three times, 30 seconds apart, mid-morning on a weekday:

| Fact | Value |
|---|---|
| Feed refresh | Every 30 s (header timestamps 30 s apart); trip updates ≤16 s old |
| Trips in TripUpdates | 126, on 16 routes |
| Per-stop predictions | ~2,650 per snapshot, median 22 per trip, up to 44 |
| Predictions 0–15 min out | ~140 per snapshot |
| Predictions that change within a minute | ~9% |
| Vehicles in VehiclePositions | 30, each reported about 7 s before the fetch |
| Feed size | 420 KB JSON (`debug=true`), 100 KB protobuf |

**Avail mostly carries one delay to every downstream stop.** Of 101 trips with
three or more future stops, 72 show the same delay at every future stop. That
is 9 of the 14 trips that had a vehicle on them at the time. Trips with no
vehicle yet are predicted at schedule (delay 0). This is the strongest link to
the Schedule Review module. When a prediction is "the schedule plus today's
delay so far", its error at a downstream stop is exactly how wrong the
schedule's remaining running time is. That is what "same running time all
day" and the PM-peak under-run readings flag. Where the review flags a
segment, accuracy for predictions across it should be measurably worse, and
the two modules can confirm each other.

OnBoard reads neither feed often enough today. TripUpdates are polled every
5 minutes into `MonitoredTripDelays`, which keeps only the current delay per
trip and clears it. VehiclePositions are polled every 5 minutes and not kept.

## 3. Where the actual arrival comes from

This is the one hard part. Prediction samples are trivial to capture, but an
accurate figure needs a trustworthy actual time for each trip-stop: the
0–3 minute bucket allows only 30 s early.

| Source | Verdict |
|---|---|
| **VehiclePositions, every 30 s**: each vehicle's trip, `CurrentStopSequence`, status (`STOPPED_AT`, `IN_TRANSIT_TO`, `INCOMING_AT`) and its own timestamp | **Primary.** A stop is reached between the last sample before the vehicle's sequence passes it and the first sample after. The vehicle's own timestamp, not the fetch time, bounds it to about ±15 s, and to its timestamp when it reports `STOPPED_AT` there. |
| **TripUpdates' passed stops**: Avail keeps times for some stops after the bus passes (244 per snapshot; 225 of 230 unchanged a minute later) | **Cross-check only.** Present on about a third of the trips in the feed, and on some only the first stop. |
| **Avail AVL Reports** (polled every 15 s already, for Event AVL) | No stop or sequence field, only position. It would need map-matching to shapes. Not worth it while VehiclePositions carries the stop. |
| **Avail OTP daily** (`OtpDailyRouteStopHour`) | Hourly aggregates at timepoints. No per-trip times. |
| **Ask Avail** for a per trip-stop arrival and departure export | Best, if it exists: the AVL system already knows. Worth one question to Avail. It would replace the derivation, not block it. |

Known limits of the VehiclePositions derivation, each handled rather than
ignored:

- **A stop passed without stopping.** The sequence still advances, and the
  passing time is the arrival, as the benchmark intends.
- **The first stop of a trip.** Use the departure, the same rule the benchmark
  applies to departures.
- **Vehicles with no trip assigned.** 4 of 30 in the sample. Their stops get no
  actual, and predictions there are left out rather than guessed.
- **Precision is bounded by the 30 s capture.** Each actual carries its
  ±window. A prediction whose verdict would flip inside that window is
  counted as indeterminate and reported, not scored. Expect a small share.

## 4. Proposed design

Same shape as the rest of OnBoard: capture cheaply, score in one pure module,
keep aggregates.

```
functions-restapi/src/
  functions/predictionCapture.ts    timer, every 30 s: fetch TripUpdates + VehiclePositions,
                                    keep predictions 0–20 min out (every other run) and every
                                    vehicle's trip/sequence/status/timestamp; append to a daily blob
  functions/predictionScore.ts      timer, 02:30 Central: score yesterday's service day
  lib/predictionAccuracy/
    benchmark.ts                    the ETA Accuracy Benchmark: buckets, windows, straight average (pure)
    actuals.ts                      actual arrival per trip-stop from position samples (pure)
    completeness.ts                 the ETA Completeness Benchmark against the day's schedule (pure)
    score.ts                        join predictions to actuals, aggregate (pure)
    store.ts                        aggregates in and out of SQL
```

- **Raw capture goes to Blob storage, not SQL.** One append blob per service
  day, gzipped CSV lines. Measured on the live feed once built: a :00 run
  writes about 540 lines (≈350 predictions up to 30 minutes ahead, ≈160 stop
  times just behind the feed, 30 vehicles) in about 5.3 KB gzipped, a :30 run
  about 0.5 KB. That is about 7 MB a day, under a dollar a month with the
  writes, and none of the load that has saturated the 1-vCore database
  before. Keep 90 days, then delete.
- **Scoring runs once a night**, outside the 4am–midnight service window, and
  writes only aggregates to SQL. Per service day, route, direction, bucket and
  hour, it stores predictions, accurate, early and late counts, and the
  variance percentiles. It also keeps per stop and bucket for the drill-down,
  and completeness per route. That is a few thousand rows a day.
- **The capture timer is a singleton**, as all Functions timers are, so two
  workers do not double-capture. Fetching a 100 KB protobuf every 30 s rather
  than the 420 KB debug JSON cuts egress from `srv.mvta.com` to about
  290 MB a day. That needs the `gtfs-realtime-bindings` package. Starting on
  the JSON at 60 s is acceptable while that is added.
- **Nothing is computed in the browser.** The agency figure comes from the
  server, from the same function as the route figure, the rule from ADR 0033.

### Where it shows

Analysis, not compliance: the same placement call made for Schedule Review.

- **A Prediction Accuracy page beside Schedule Review** under Specialist
  Operations. A route table shows the overall figure, the four bucket figures
  and completeness, with the agency total on top computed the benchmark's way.
  It also shows a daily trend, the period picker (7, 28 or 90 days, matching
  the observed grid) and the worst stops and hours for a route.
- **On Schedule Review**, a route's accuracy beside its flags, and on a flagged
  segment the accuracy of predictions across it. This is where the two modules
  pay off, in a sentence of this shape (the accuracy figures are placeholders;
  nothing has been measured): "Rosemount → 157th westbound, PM: scheduled the
  same 20 min all day; 46% late at 157th; predictions across it X% accurate in
  the PM peak against Y% midday."

## 5. Increments

| # | Increment | Size |
|---|---|---|
| 1 | Capture timer and daily blob; feed-run ledger and freshness entries so Integrations & Data Health shows it; `benchmark.ts` with tests from the published windows | small |
| 2 | `actuals.ts` and `score.ts`, tested on a captured day; nightly scorer; aggregates table (one migration); first comparison against Swiftly's September figures for 490 and 470 | medium |
| 3 | API and the Prediction Accuracy page: route table, agency total, buckets, trend, period picker | medium |
| 4 | Completeness benchmark; accuracy on Schedule Review routes and flagged segments; stop and hour drill-down | medium |

The first useful number arrives one service day after increment 2 deploys,
and a stable route figure after about two weeks of weekdays.

## 6. Risks and decisions

- **Adopt the benchmark exactly** (recommended), rather than an OnBoard
  variant. Its windows are stricter on early than late on purpose, and
  matching it is the only way the numbers can be read against Swiftly's.
- **Forward only.** Predictions were never stored, so September cannot be
  recomputed. The comparison with Swiftly's 49% and 79% will be against a
  later window, with whatever schedule and feed are live then.
- **Our actuals are not Swiftly's.** Swiftly derives arrivals from its own
  high-frequency AVL. OnBoard's are bounded by a 30 s position feed. Expect
  agreement within a few points, and report the indeterminate share so
  nobody reads precision the data does not have.
- **Feed outages are not inaccuracy.** Minutes when either feed is stale are
  left out and counted, using the freshness rules OnBoard already has, so a
  feed gap reads as a coverage gap and not as bad predictions.
- **Ask Avail** whether a per trip-stop arrival export exists. If it does, it
  becomes the actual and section 3's derivation becomes the fallback.
