# Declare the garage departure rule once and render the SQL from it

**Status:** accepted

The rule that decides whether a **Garage departure** is worth charging to the
contractor has to exist in two forms. The console judges a row it already
holds, per row, and says why - late, no departure, departed, unresolved, no
schedule, not settled. The nightly candidate poll has to select the same rows
out of a table, as a `WHERE` clause. Same rule, two readings of it.

Until now both were written by hand, once as TypeScript branches in
`lib/fixedRouteDepartureOutcome.ts` and once as SQL text in
`lib/occurrenceIntake/sources.ts`, and kept in step by comments - literally
"Mirrors garageDepartureCandidatePredicate() clause for clause". That is not a
safe arrangement for this rule in particular, because a candidate is never
withdrawn: if the predicate is wider than the ladder, a contractor is charged
for a departure the console shows as fine, and intake has no path that takes it
back.

It was already going wrong. In 1.5.285 the placeholder clause was added to both
sides; in 1.5.286 it was rewritten in both. By then the one idea - "scheduled
at midnight, agency time" - read as `agencyMinuteOfDay(d) === 0 &&
d.getUTCSeconds() === 0` in TypeScript and as `CAST(col AT TIME ZONE 'UTC' AT
TIME ZONE 'Central Standard Time' AS TIME) <> '00:00:00'` in SQL. Two unrelated
idioms, two files, one comment between them. Both were right; nothing except
care was keeping them that way.

**So the rule is declared once.** `lib/garageDeparture` holds an ordered ladder
of arms per service type - a list of conditions and the outcome they produce.
Judging a row walks the ladder and takes the first arm that matches, which is
what the if-ladder already did. The candidate predicate is DERIVED from the
same ladder: a row is a candidate when it lands on an arm whose outcome is a
candidate outcome, which is that arm's conditions holding while every arm above
it failed. Never hand-write the predicate again.

**The condition vocabulary is closed.** Six kinds, no raw-SQL escape hatch. An
escape hatch is exactly how the two spellings drift, so a seventh kind is a
visible change to `conditions.ts` rather than a quiet bypass - and that file is
the only place the agency time zone is spelled, under both the IANA name Node
needs and the Windows name SQL Server needs.

**Two declarations, not one parameterised rule.** ADR 0028 settles that garage
departure is one concept with one source per service type. The fixed-route
ladder turns on Avail's status ladder and its midnight placeholder; the
on-demand one has neither, and has a cancelled-duty arm instead. Collapsing
them behind a service-type flag would bury the only thing that actually
differs. They share the vocabulary, the evaluator and the renderer, which is
where the duplication actually was.

**Conditions are stated positively; negation belongs to the renderer.** A
hand-written negation is the single thing here most able to silently widen the
set of rows charged to a contractor - migration 088a had to write one out by
hand and annotate it as "the exact negation of the poller's predicate". The
renderer negates by De Morgan over each condition's own negation rather than
wrapping a conjunction in `NOT`, because `NOT (a AND b)` is UNKNOWN under a
NULL and would drop rows the ladder keeps.

## What this costs

The generated statement is more verbose than the hand-written one. It keeps
guards a person would have simplified away, because it does not know which
clauses imply each other, and it is a disjunction of one arm per candidate
outcome rather than a single conjunction. It is logically equivalent, and no
attempt is made to simplify it - a simplifier would be new logic able to be
wrong, in the one place this ADR exists to make trustworthy.

Equivalence is proved twice: over a spread of rows in
`garageDeparture.test.ts`, and executed for real against SQL Server, one row
per arm, in `occurrenceIntake.db.contract.test.ts`. The second is the one that
settles it, and it runs wherever a connection string exists.

## What this does not fix

`settledServiceDateExclusive()` moves into the module unchanged and is known to
be wrong. Avail publishes the next day's roster at 02:30 local and keeps
updating it, so a service date is not actually frozen until 02:30 local two
days later, while this calls it settled after one. `complianceCandidatesPoll`
only gets away with it by running a full day behind; moving it earlier without
fixing this would raise candidates against runs still in flight. See the note
in `lib/availPullout.ts`. Fixing it re-dates stored rows and the source
references of occurrences already raised from them, so it needs its own
evidence and its own backfill, the way migration 138 got.
