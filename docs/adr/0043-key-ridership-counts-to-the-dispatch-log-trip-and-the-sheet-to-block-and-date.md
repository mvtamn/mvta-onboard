# ADR 0043: Key ridership counts to the Dispatch Log trip, and the Count Sheet to block and date

Status: accepted (2026-10-30)

## Context

MVTA replaces its paper Count Sheet and Microsoft Access ridership process
with OnBoard before Keolis takes over operations on 2027-01-01
(`plans/ridership-counting-spec.md`, `plans/ridership-build-plan.md`). In the
old process, Planning built a trip roster from Optibus through Excel into
Access (`Riders_FINAL`), keyed each trip with an Access TripID such as
`143620542`, and decided each block's garage from that roster by hand.

OnBoard already has a list of every revenue trip that ran on a service date:
the Dispatch Log (`TripStartLog`, migration 094), one row per GTFS trip, with
its block, route, direction, scheduled start and start status, materialized
for today and tomorrow every morning. A ridership count needs the same trip
list. So the question is whether to key counts to that list, or to a roster of
ridership's own.

## Decision

1. **A count is keyed by `(service_date, trip_id)`, where `trip_id` is the
   Dispatch Log's GTFS trip.** The trips a sheet shows, and which of them need a
   count, come from `TripStartLog` on that date. Ridership has no roster of its
   own. A trip the Dispatch Log calls missed or canceled, or a missed-trip case
   confirms, is excused (spec §5).
2. **A Count Sheet is keyed by `(service_date, block)`, with block in the
   three-digit form printed on the sheet (`001`).** This is the form
   `workbookBlock()` already reads out of `TripStartLog.block_id`, and the block
   number Avail's pull-out carries, so the operator and bus can be pre-filled
   by joining on it.
3. **Each trip is keyed as counted, not counted, or did not operate.** A trip
   that nobody counted is stored as a gap, never as a zero, and only a counted
   trip carries a number.
4. **Unscheduled trips are rows of their own on the sheet** (route, direction,
   start, reason), not invented Dispatch Log trips.
5. **Garage is Planning's list, dated by service change**
   (`RidershipBlockGarages`). It is not derived from Avail or from GTFS, and a
   block with no entry shows as Unassigned.
6. **Every change to a sheet, count or added trip is written to
   `RidershipCountHistory`** with who and when. A sheet's `entered_at` is set
   once, the first time it is complete, and lateness is judged on that.

## Consequences

- The Optibus → Excel → `Riders_FINAL` roster build goes away. When the
  schedule changes, the next day's sheets change with it, because the Dispatch
  Log does.
- The Access TripID is not stored. December 2026's exports carry both the GTFS
  `trip_id` and an Access-style TripID derived from route, direction and start
  for the parallel run. How Access builds that ID is still to be confirmed with
  Planning. From January only the GTFS `trip_id` is kept.
- GTFS trip IDs change at a service change. So anything that compares a trip
  across weeks, like the 4-week median behind the outlier flags (January),
  matches on route, direction, scheduled start and day type, not on `trip_id`.
- Sheets for tomorrow can be printed the evening before, because
  `tripStartLogMaterialize` writes tomorrow at 04:30 local. The operator and bus
  are filled in at entry, not at print: Avail publishes the day's roster at
  about 02:30 on the day itself.
- `TripStartLog` gains `scheduled_end_seconds` (migration 153) so the sheet can
  print the end time. The materializer writes it when both columns exist and
  leaves the log unchanged when they don't.
- The two roles, `ridership-recorder` and `ridership-manager`, are app-owned
  (ADR 0032) and are seeded by migration 154, granted to nobody.
