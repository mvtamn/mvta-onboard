# 47. Place an Avail record by the trip that left that minute

Date: 2026-11-06

## Status

Accepted. Amends the matching rule in
[ADR-0035](0035-corroborate-missed-trip-cases-with-avail-without-letting-it-decide.md).

## Context

ADR-0035 links an Avail missed-trips record to a Missed-trip case when route, service date and
start time agree to the minute. It reasons that "both sides derive their start time from the
same published schedule", and so concludes that a looser tolerance would only manufacture
ambiguity.

That premise is wrong. Avail's `DepartureTripStartTime` is the minute the bus actually left, cut
to the minute, not the published start. Measured on dev on 2026-11-06 over the 2,018
arrival-only records from 2026-10-06 to 2026-11-02:

- 1,039 matched a scheduled start to the minute, and 988 of those also fell within a minute of
  the Dispatch Log's actual start (they were on-time departures).
- 865 were 1–5 minutes off a scheduled start, skewed late. 775 of them (90%) fell within a
  minute of the Dispatch Log's actual start.
- Avail truncates: a bus that left at 15:31:08 is reported as 15:31.

Matching against the schedule therefore drops every record for a bus that left more than a minute
late. It can also hand a record to the wrong case: if a case is scheduled at 14:00 but its bus left
at 14:06, and a different trip left at 14:00, the 14:00 record goes to the 14:00 case. The research
note `docs/research/avail-vs-gtfs-rt-missed-trip-detection-2026-11-04.md` (addendum) has the
queries.

## Decision

A record with a start time is placed in two steps:

1. **Resolve it to a trip.** Among every trip on that route and service date (`TripStartLog`),
   find the trip whose departure fell in Avail's minute. A trip's departure is its Dispatch Log
   actual start when that reading is plausible (no more than 30 minutes early or 3 hours late),
   otherwise its scheduled start.
2. **Look for a case on that trip.**

| Outcome | When |
|---|---|
| exact | Exactly one trip left that minute, and it has a case. |
| probable | More than one trip left that minute, or the record has no start time. |
| unmatched | No trip left that minute, or the one that did has no case. The link's reason names that trip. |

A route-day with no Dispatch Log rows keeps ADR-0035's rule, a case scheduled that minute. The log
starts on 2026-08-31, and Avail restates three months.

The minute stays strict. 240 records in the 95-day window have no departure in their minute; about
90 of those have one within a minute either side. Widening the window would recover them, but
would let two trips on a frequent route claim one record. Those records stay unmatched, with a
reason a reviewer can read.

Everything else in ADR-0035 stands. Avail opens no case, a probable link changes nothing until a
reviewer confirms it, evidence is copied, and a contradiction is an Evidence conflict.

## Consequences

- On dev's 95-day window, route-days the log covers go from 57 exact links to 69. Of the 57, 54
  keep the same trip, and 3 move: one was the wrong trip, one is now two trips in that minute, and
  one's case bus left 14 minutes after Avail's time. The 85 exact links on uncovered route-days
  are unchanged.
- The nightly pass reads `TripStartLog` for the dates that have timed records, about 600 trips a
  service day.
- A link that moves is handled by `recordAvailLinks` as it already is: a changed confidence or trip
  clears a reviewer's answer, because it is no longer the link they answered.
- The plausibility bounds exist because dev's Dispatch Log stored every 2026-09-09 reading a day
  late. Across every other dev reading to 2026-11-06, no departure ran more than an hour late.
- Entire-trip misses still carry no start time, so this changes nothing for them.
