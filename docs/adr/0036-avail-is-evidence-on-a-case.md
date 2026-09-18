# 36. Avail is evidence on a case, never a case of its own

Date: 2026-09-18

## Status

Accepted

## Context

OnBoard has had three missed-trip pipelines and only two of them meet. GTFS and
Spare both reach `MonitoredMissedTrips` through the Missed-trip case module.
Avail's own retrospective report has, since migration 015, had its own table
(`AvailMissedTripsRouteStopDay`), its own page (OTP Compliance → Monthly
Assessments) and no contact whatsoever with a case. A trip can be a confirmed
missed trip in one and absent from the other, and nothing notices.

`CONTEXT.md` already names the machinery for joining them, and none of it
existed:

- **Retrospective reconciliation** — comparing a scheduled run and its live
  evidence with later operational records after the operating window closes. "A
  source match may be exact, probable, or unmatched and does not replace human
  confirmation."
- **Evidence-match confidence** — exact, probable, unmatched. "Probable links
  require reviewer confirmation before affecting a Missed-trip case."
- **Evidence conflict** — two exact-matched sources supporting incompatible
  findings. "Never resolved by an undocumented source priority."
- And the rule that unresolved conflicts block Service attribution and
  Assessment promotion.

Writing an adapter without deciding these would have invented all four by
accident, which is why this candidate needed a decision rather than a refactor.

The grains do not meet either. Avail reports route, stop, day and a scheduled
start; a case is a trip id on a service date. There is no shared key, so any
join is a match.

## Decision

**Avail is evidence on a case.** It is matched to cases OnBoard already holds,
it never opens one, and it never confirms one.

1. **Evidence, not detection.** A vendor report arriving the next morning is
   exactly the retrospective source CONTEXT's reconciliation term describes. It
   is not a detector: it does not watch service, and it is not subject to
   detector promotion (ADR-0035) — it corroborates, so it must never appear in
   the promotion history.
2. **Avail opens no cases.** An incident that matches nothing is recorded as
   unmatched and stops there. Avail cannot describe a trip GTFS never saw
   without inventing a case with no scheduled identity, and a case with no
   scheduled identity cannot be reviewed against anything.
3. **Matched against cases, not against the schedule.** `GtfsScheduledTrips` is
   overwritten by the daily GTFS sync — CONTEXT defines Schedule snapshot as
   retained, but nothing implements it — so a case from last Tuesday can no
   longer be resolved through the schedule reliably. The case carries the
   scheduled start stamped when it opened, and that is what Avail is compared
   against. The schedule is consulted only for the first stop, and its absence
   downgrades a match rather than failing it.
4. **Exact needs four things to agree:** service date, route, scheduled start to
   the minute, and Avail's departure stop being the trip's first stop. Agreement
   on time but not on stop is **probable** — very likely the same trip, which a
   reviewer says. Two cases sharing a route, day and start time are
   **unmatched**: a link that cannot name one case is not a link, and saying so
   beats guessing.
5. **Links are keyed by the incident's natural tuple**, never by a row id. The
   Avail table is deleted and re-inserted in full every night, because the feed
   has no per-record key, so anything keyed to its identity column would be
   destroyed each run.
6. **An incident the feed stops reporting is marked, not deleted.** "Avail no
   longer says this happened" is a fact about the feed and a thing a reviewer
   may need to know; silence is not.
7. **A link that moves loses its confirmation.** If the matched case or the
   confidence changes, the link is no longer the one the reviewer agreed to, so
   the confirmation does not carry over.

## Consequences

- Migration 135 adds `MissedTripSourceLinks`. Nothing is reconciled by applying
  it; the table starts empty and no figure moves.
- Reconciliation is its own nightly run, half an hour after the Avail reload, so
  each night's links reflect what Avail reported that night.
- Two things follow from this decision and are built on top of it: the Evidence
  conflict rule (an exact-matched source contradicting a review blocks
  assessment promotion) and the reviewer's surface for confirming a probable
  link. Neither is in this decision's first increment.
- The Monthly Assessments page keeps reading the Avail table directly. This adds
  a second reading of the same rows for a different question, and does not
  change the first.
- Reconciliation walks incidents one row at a time. The window is three months
  of one agency's missed trips on a nightly timer, so the simple shape is worth
  more than the throughput; if the volume ever justifies it, the matcher is pure
  and the write is the only thing that would change.
