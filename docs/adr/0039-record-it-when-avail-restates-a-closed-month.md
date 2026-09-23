# ADR 0039: Record it when Avail restates a closed month

Status: accepted (2026-09-22)

## Context

The OTP Compliance validation handed to Rob
(`docs/handoffs/otp-compliance-validation-plan-2026-09-22.md`) could not close
case T1.4 - "a re-poll does not change a closed month" - because OnBoard had no
way to answer it.

`upsertOtpMonthlyReport` set `updated_at = SYSUTCDATETIME()` on every MERGE
match, whether or not one value had changed. The poll re-reads a trailing
window of the current month plus two, so after every nightly run every row in
three months carried that run's timestamp. `updated_at` meant "the poller ran",
not "this number moved". Nothing anywhere kept the previous figure either, so
even a detected change could not say what it changed from.

This matters because the contractor's assessment is computed from these rows.
A finalized period is frozen (ADR 0006), but the live figure beside it is not:
if August is assessed at 83.62% and Avail later publishes different August
numbers, OnBoard adopts them, the two figures diverge, and nobody can say when
or by how much. "What did we assess on, and has the source moved since?" had no
answer.

## Decision

**`updated_at` moves only when the row says something different.** The MERGE
gains `WHEN MATCHED AND <differs>`, so a no-op re-poll writes nothing and the
timestamp becomes evidence rather than noise.

The comparison is `EXISTS (SELECT target.<cols> EXCEPT SELECT @<params>)`, not a
chain of `<>`. A column going from NULL to a number - a stop that reported no
departures and now reports some - is exactly the change worth catching, and
every `<>` against NULL is unknown. EXCEPT treats two NULLs as equal, which is
the intent.

**A change to a month that is already over is recorded as a restatement**, in
`OtpMonthlyRestatements`, with what the row used to say and what it says now.

Three things are deliberately *not* restatements:

* **A first ingestion.** There was nothing to restate.
* **A change inside the month's own service month.** The month fills as service
  days are published, and every poll legitimately changes almost every row.
  Recording those would write thousands of rows a month and bury the real
  thing. Once the month is past, a different number for it is a restatement of
  something already reported.
* **A label or percentage moving on its own.** The contractor is assessed on
  the counts. The row is still updated - `updated_at` is about the row - but the
  ledger stays about the figure.

**No settling window.** The last service days of a month land in the first days
of the next, so a legitimate tail appears here as a restatement a day or two
after month end. Rather than guess a cutoff that would also hide a real early
restatement, every change is recorded and `DaysAfterMonthEnd` travels with it in
`vw_OtpRestatement`, so the reader draws the line rather than the schema.

**One statement, not three.** The MERGE's `OUTPUT` is the source the ledger's
`INSERT` selects from (composable DML), so a poll that changes nothing costs
what it always did, and there is no window in which the row has moved but its
history has not been written.

**The ledger's existence is read once per run**, not per row. The poll upserts
about 2,700 rows a night; probing each time would double its round trips to
answer a question that cannot change mid-run. `ledgerReady` is a required
option rather than a defaulted one, because defaulting it false would silently
stop recording if a new caller forgot it - and that failure looks exactly like
"Avail never restates anything".

## Consequences

T1.4 becomes answerable: `vw_OtpRestatement` is empty if Avail never restates,
and names the month, route, stop, day, both figures, both deltas and how long
after month end otherwise. Rob can query it alongside the other reporting
views.

Whether Avail restates at all is now an open empirical question rather than an
unanswerable one. Every closed month on dev currently carries a timestamp from
the last poll, so nothing can be said about the past; the ledger starts from
the first poll after migration 141.

An admin backfill of an already-ingested past month records restatements like
any other writer, which is correct - it is the same event, triggered by hand.

Nothing surfaces this in the console yet. The reporting view was chosen first
because the person who needs it is validating through raw reporting anyway; a
banner on Integrations & Data Health would be the natural follow-up, and is the
place a reviewer would find out without being told to look.
