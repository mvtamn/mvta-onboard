# Corroborate Missed-trip cases with Avail without letting it decide

**Status:** accepted

Avail's Missed Trips By Route/Stop/Day report reaches Missed-trip cases as a
third source adapter, but it only speaks about cases that already exist. It
never opens one. Avail is the vendor's own retrospective account and is the
strongest evidence available for a run that has finished, which is exactly why
it is not allowed to raise a finding unreviewed: a detector that creates cases
enters Shadow detection, and a three-month backfilled window arriving as a
queue of candidates would be a second unfinished detection programme running
beside the GTFS one. Whether Avail should also create cases is worth revisiting
once the silent no-show detector leaves Shadow detection.

Avail names no trip. A record carries a route, a calendar date, departure and
arrival stops, and a departure trip start time, so a link to a Scheduled-run
identity is built from route, local service date and Published Trip start. A
link is **exact** when those three agree to the minute and name exactly one
case; **probable** when the start time is absent or more than one case matches;
**unmatched** when no case does. Both sides derive their start time from the
same published schedule, so a looser tolerance would not recover real matches -
it would only manufacture ambiguity on a frequent route. A probable link is
recorded and shown but changes nothing until a reviewer confirms it, and an
unmatched Avail record is reported as a count, not stored against a case.

Avail evidence is copied onto the case rather than referenced. The feed has no
per-record natural key, so its ingestion replaces every row in a trailing
three-month window daily and the row identities do not survive the night. A
reference would therefore dangle by construction, and a case's evidence would
silently change whenever Avail restated a month. Retained missed-trip evidence
has to outlive its source telemetry, so the matched facts are snapshotted.

A trip Avail reports as missed in whole is corroborating evidence of a missed
trip. A trip whose departure or arrival stop was missed while the trip itself
ran is a Partial-service failure - a run that operated but failed to provide a
scheduled portion of passenger service - which is already one of the four
Missed-trip review outcomes and needs nothing new to represent.

Where Avail contradicts what a case already concluded, the case records an
Evidence conflict and stops there. It is never reopened, never re-closed, and
no review outcome is rewritten. An Evidence conflict blocks Assessment
promotion while leaving the operational outcome intact, so a disagreement
between two exact-matched sources cannot quietly become a charge against the
contractor, and cannot quietly be dropped either. Resolving it is a reviewer's
job with both sources in front of them.

## Consequences

Avail can corroborate, contradict and enrich a case, and can do none of those
things to a run no other source ever noticed - a trip missing from both GTFS
detection and the schedule snapshot stays invisible until Avail is allowed to
create cases. The unmatched count is the measure of that gap and is reported on
every run.

## Considered Options

- **Let Avail create cases.** Rejected for now: it is a new detector, so
  Shadow detection applies in full, and the first run would backfill three
  months at once.
- **Match on route and date alone, treating every link as exact.** Rejected:
  on a frequent route that is several cases per record, and it discards the
  Evidence-match confidence the domain already defines.
- **Reference the Avail row instead of copying it.** Rejected: the rows are
  deleted and reinserted nightly, so the reference dangles and the evidence
  changes under a case that has already been reviewed.
- **Resolve a conflict by preferring the newer or the vendor source.** Rejected:
  an Evidence conflict is never settled by an undocumented source priority.
  Preferring Avail would let a vendor report overturn a human review; preferring
  the case would hide the contradiction entirely.
