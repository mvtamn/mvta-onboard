# Contradict a no-show with Avail's departures at its origin

**Status:** accepted

ADR-0035 lets Avail corroborate and contradict Missed-trip cases without
deciding them, and defines an Evidence conflict as two *exact-matched* sources
supporting incompatible findings. Avail's missed-trips report cannot contradict
a silent no-show: its whole-trip misses carry no start time, so they never link
exactly (the 2026-11-04 assessment, `docs/research/avail-vs-gtfs-rt-missed-trip-detection-2026-11-04.md`).
Avail OTP Daily can. It counts departures per route, stop and local hour, and
the assessment found it contradicting 17 of 58 escalated silent no-shows that
the Dispatch Log could not.

We add a fourth Avail fact, a **Departure observed at origin**: on the case's
route, at its origin stop (the Dispatch Log's `origin_stop_id`, Avail's
`stop_id`), in the Central calendar date and hour of its Published Trip start,
Avail called no departure missed and saw at least as many as runs were
scheduled to start there. Both conditions are needed. OTP Daily counts every
departure of the route from the stop, trips that only pass through it included,
so a count alone can exceed the runs that start there while one stayed put.
With none missed, every departure Avail expected in that hour left, and this
run is one of them. That is an exact statement about the run reached through an
hour, which is why it may raise an Evidence conflict even though no record
names the trip.

It is evidence, not a Trip start. It never opens, closes, reopens or rewrites a
case. It is kept on every fixed-route case it speaks about, and raises an
Evidence conflict only against a case that says the run never started: an
unreviewed escalated case, or a Confirmed missed trip, with no start seen at
all. A run that started past its deadline departed, and the evidence agrees
with it.

The conflict is raised the first time the evidence arrives and not again.
Avail restates OTP Daily every night, and a reviewer who settled the conflict
did so with that evidence in front of them. Re-raising it nightly would undo
every review.

Silence says nothing. A shortfall cannot say which run did not leave, and an
origin hour with no OTP row is where Avail does not detect departures at all
(Burnsville Center: no row for 776 of 776 scheduled origin-hours in October).
Neither supports a missed trip.

## Consequences

- The review queue shows the contradiction, with Avail's counts, beside the
  case. An Evidence conflict blocks Assessment promotion until a review settles
  it.
- It arrives late. OTP Daily is ingested at 12:00 UTC and reconciled at 03:00
  UTC, so a service day is contradicted on the second night after it.
- It is only as independent as Avail is. MVTA's GTFS-RT may come from the same
  Avail platform, so a shared outage can silence both. Shared silence produces
  no contradiction rather than a false one.
- A stop id that differs between GTFS and Avail produces no row, and so no
  evidence, rather than wrong evidence.

## Considered Options

- **Compare departures with the GTFS schedule alone.** Rejected: pass-through
  trips inflate the count (5 departures against 2 scheduled origin starts at
  Apple Valley Transit Station NB on 2026-11-02).
- **Let it close a case as Timely service.** Rejected: hour-level evidence
  cannot be Qualifying progress evidence, and closing would hide the case from
  the reviewer who must settle it.
- **Show it only at read time, with no conflict** (PR #510). Useful and
  complementary, but nothing would stop a Confirmed missed trip contradicted by
  Avail from counting toward an assessment.
