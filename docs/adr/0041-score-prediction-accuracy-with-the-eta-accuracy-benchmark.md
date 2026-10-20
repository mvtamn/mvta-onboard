# ADR 0041: Score prediction accuracy with the ETA Accuracy Benchmark

Status: accepted (2026-10-16)

## Context

Swiftly's comparison of September 1-20, 2026 put MVTA's arrival predictions
between 49% (route 490) and 79% (470) accurate. OnBoard could not say whether
that was getting better, which routes and hours drove it, or how it related to
the schedule problems the Schedule Review module flags, because it measured
nothing. `plans/prediction-accuracy-evaluation.md` showed it can, from the two
GTFS-realtime feeds riders' apps already read.

An accuracy figure is only as useful as its definition is shared. There are
several in use: different horizons, symmetric or asymmetric windows, pooled or
averaged buckets. A figure computed our own way would not read against
Swiftly's, and every comparison would start with an argument about method.

## Decision

OnBoard scores prediction accuracy with the **ETA Accuracy Benchmark** that
Transit and Swiftly publish (github.com/TransitApp/ETA-Accuracy-Benchmark),
unmodified: four buckets by time from sampling to actual arrival (0-3, 3-6,
6-10, 10-15 minutes), each with the published window around the predicted
time, the earlier side tighter than the later, and an overall figure that is
the straight average of the four bucket shares. `lib/predictionAccuracy/
benchmark.ts` is that definition and nothing else.

The benchmark leaves three things open. OnBoard decides them as follows and
says so wherever a figure is shown:

- **Sampling**: one sample of every prediction a minute, from the TripUpdates
  feed, stamped with the feed's own timestamp.
- **Actual arrival**: derived from VehiclePositions read every 30 seconds,
  when a bus's stop sequence moves past the stop. Avail's own kept stop times
  cross-check it. Precision is about ±15 s; a prediction whose verdict would
  flip inside that is reported as indeterminate, not scored.
- **Totals**: a route's figure is the benchmark over that route's
  predictions, and the agency's is the benchmark over all predictions
  combined, never an average of route figures.

Raw capture is kept in Blob storage for 90 days, and only the nightly
aggregates go to SQL.

## Consequences

- OnBoard's figures can be read against Swiftly's, within the precision of
  the actuals, and against any agency that publishes the same benchmark.
- Measurement is forward-only: predictions were never stored, so the
  September window cannot be recomputed.
- Changing the method later means a new ADR and a restated history, because
  a figure from before and after the change would not compare.
