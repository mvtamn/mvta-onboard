# ADR 0043: Retire the OTP monthly keys Avail stops returning

Status: accepted (2026-10-30)

## Context

ADR 0042 made every stored OTP figure carry the measurement standard it was
polled under, and derived "months needing re-pull" from those stamps rather
than tracking them in a queue: a month needs re-pulling when any of its rows
carries a stamp other than the set in force, a missing stamp included. Deriving
it was the right call — re-pulling a month clears it with nothing to mark
resolved — and it has one consequence nobody traced at the time.

On 2026-10-29 all ten months were re-pulled under the declared set. On
2026-10-30, eleven rows still carried no stamp: eight in 2026-05, two in
2026-08, one in 2026-09. Every one of them is a route, stop and day of week
that Avail no longer returns for that month — 2026-09's is route 499 at
Shakopee Walmart on Thursdays, 17 departures, last touched 2026-10-28.

**The monthly upsert has no mechanism to notice a key that stopped coming
back.** It is a MERGE keyed on (service_month, route_id, stop_id,
day_of_week), and a MERGE says nothing about rows its source did not mention.
That was harmless while a row could only ever gain figures. It stopped being
harmless the moment a row's `measurement_parameters` meant "the standard this
figure was polled under", because a row no poll can reach is a row nothing can
ever stamp.

So those three months would have sat on the re-pull list permanently, each with
a Re-pull button that could not clear them. **A list that cannot reach empty
stops being read**, and ADR 0042 built that list specifically so a stale figure
could not hide. Two re-pulls later it would have been furniture.

The figures are the smaller half of this. The stale rows are 67 departures in
2026-05 (87.560% with them, 87.574% without), 2 in 2026-08 and 17 in 2026-09 —
well inside the Tier A comparison's 0.5-point standard. They are still wrong:
they are figures Avail no longer publishes, measured to a standard MVTA no
longer uses, counted into a contractual number.

## Decision

**A key the month holds that a poll of that month did not return is retired:
copied whole to `OtpMonthlyRetiredKeys` and deleted from
`OtpMonthlyRouteStopDay`** (migration 152).

**Retired means removed, not flagged.** Eleven queries in ten places read the
monthly table — the month module (twice), the OTP month endpoint, the
flagged-stop rule, route classification, the date-exclusion snapshot, the
provenance read itself, and the reporting views of migrations 106, 140, 141 and
151. A flag is only as good as the last
reader to honour it, and a reader that forgot would produce a figure that
disagrees with itself depending on which query asked. Deleting the row cannot
be half-applied. The archive is where the row still exists, carrying its
figures, its `first_seen_at`, its `updated_at` and its stamp, plus why it was
retired and by what.

**Absence alone retires nothing.** A truncated response and a shrunken month
look identical from the payload, and acting on the wrong one deletes real
figures. A poll may retire the keys it did not return only if it accounted for
at least 90% of the month's stored keys, and only if every one of its own
upserts landed. The threshold is a judgement: the real cases are 1–8 keys in
850–1,000 (0.1–0.9%), so anything near the threshold is not the case this
exists for — what it rules out is arithmetic over a bad delivery.

**A refused retirement is logged loudly and returned to the console.** A month
that really did lose a tenth of its keys is a question for a human, not a
cleanup, and the admin watching a re-pull is the only person positioned to ask
it. So the quiet path is the one that retires; the noisy path is the one that
declines to.

**Retiring is self-healing in both directions.** If Avail sends the key again,
the upsert inserts it again, stamped with the standard of the poll that brought
it back; the archive keeps the earlier life, so a key that comes and goes
leaves a legible history rather than a row that quietly changed meaning. And a
retirement needs no separate "unretire" — the feed is the only writer.

**The re-pull list is unchanged.** It still reads the stamps, and it still
counts an unstamped row against its month. What changes is that the rows which
could never be stamped are no longer there, so the list can reach empty — which
is what makes it worth reading.

**The migration retires the eleven rows already stranded**, under a narrower
rule than the feed's, because it has no payload to measure coverage against: a
row with no stamp in a month that *has* stamped rows was not in what came back
when that month was re-polled. A month with no stamped rows at all has simply
not been re-polled since migration 151, and is left alone.

## Consequences

**Three months leave the re-pull list, and two of them are Tier A months.**
2026-05 and 2026-08 are in the comparison
(`docs/handoffs/otp-compliance-validation-plan-2026-09-22.md`). Their figures
move by about 0.014 and 0.001 points, which is below anything the comparison
can resolve, but the move is real and the archive is what explains it.

**The monthly table can now lose rows, which it never could before.** That is
the point, and it is also the risk: a bug in the coverage gate deletes
contractual figures. Three things stand against it — the gate itself, the
archive (nothing is deleted that is not first copied, in one transaction), and
a db contract test that runs the retirement against real SQL, including the
case where a short payload must retire nothing.

**Feed health still reads the records Avail sent**, not the rows the table
holds, so a month that retires keys does not read as a month that lost records
(`feedHealthOutcome`, and the same reasoning 1.6.48 used for a collapsed pair).

**`OtpMonthlyRestatements` keeps pointing at retired keys, deliberately.**
Migration 141's ledger carries no foreign key precisely so history outlives the
figure it describes. A restatement of a key that was later retired is still
something that happened.

**The daily table is left alone.** `OtpDailyRouteStopHour` keys on a date and
an hour rather than a day of week, the re-pull list does not read it, and no
stranded row has been observed there. If one is, this is the shape of the fix,
not a new decision.

**It does not make a vanished key explainable.** Avail publishes no reason for
dropping a route/stop/day, so the archive records that it stopped coming back
and when — not why. A pattern of retirements on one route is a question to ask
Avail, and now there is something to ask it with.
