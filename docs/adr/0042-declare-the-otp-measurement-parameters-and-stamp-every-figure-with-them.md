# ADR 0042: Declare the OTP measurement parameters, and stamp every figure with them

Status: accepted (2026-10-27)

## Context

Fixed-route OTP is contractual. A month's figure decides a performance tier,
and a tier decides what the contractor owes. That figure is not computed in
OnBoard: it is polled from Avail's `OtpByRouteStopDayAgg` and
`OtpByRouteStopDayHour` operations, which take the measurement standard itself
as URL segments — early threshold, late threshold, early outlier, late
outlier, show missed stops, include outliers, show detours.

Those seven numbers were a compiled constant, `OTP_PARAMETERS` in
`lib/availClient.ts`. On 2026-10-27 they were corrected from `1/5/15/30/0/1/1`
to `2/5/10/60/0/1/1` (1.6.39), after Avail confirmed MVTA's BI configuration is
early 2 / late 5 / early outlier 10 / late outlier 60. Only the late threshold
had been right.

**The mismatch survived for months, and neither reason was carelessness.** The
thresholds were believed enum-constrained by the API schema; they are not, and
Avail confirmed they are configurable. The outlier values were copied from the
example in Avail's own API specification, deliberately, to rule out our
configuration as a source of error while the feed was being diagnosed (see
`plans/OTP-Feed-Evaluation-and-Recommendation.md`) — and then never aligned
once it had been ruled out. The code comments called them an "owner decision",
which is precisely what they were not.

Three things follow, and together they are why this is a provenance decision
rather than a refactor.

**The standard is not ours, and it moves without telling us.** Avail stated
MVTA's thresholds are "configurable on the backend". A compiled copy of
somebody else's configuration diverges silently by default; the only question
is when.

**Nothing in the database says what a stored figure was measured under.**
`OtpMonthlyRouteStopDay` and `OtpDailyRouteStopHour` hold a number per route,
stop and day of week, and nothing beside it. On 2026-10-27 every row in both
tables had been polled under `1/5/15/30`, and the correction restated none of
them: the monthly poller's trailing window (current month plus two) refreshed
the recent ones within a day, and everything older kept the old standard until
somebody ran a backfill. So the tables now hold figures measured two different
ways, and no query can tell them apart. That is not a transitional
inconvenience — it is the permanent shape of the problem, because this will
happen again.

**The Tier A comparison depends on the answer.**
`docs/handoffs/otp-compliance-validation-plan-2026-09-22.md` puts three months
— 2026-05, 2026-06 and 2026-08 — against the manual figure, accepting OnBoard
as system of record only if every month agrees within 0.5 points and no month
lands in a different tier. Two of the three sit under a point from the 85%
boundary. All three are outside the poller's trailing window, so all three
still hold `1/5/15/30` figures. Running Tier A against them now would compare
two different measurement standards and call the difference a defect in
OnBoard.

ADR 0039 already settled the sibling case: when Avail restates a closed month,
record it, because "what did we assess on, and has the source moved since?"
must be answerable. A change to our own request parameters moves every figure
in exactly the same way, and until now left no trace at all.

## Decision

**The parameter set is a declared record with an effective-from date, not a
setting that gets edited.** `OtpMeasurementParameters` (migration 151) is
append-only: a change is a new row, and no row is ever updated or deleted.
Editing a past row would retroactively rewrite the meaning of every figure
polled under it, which is the thing this ADR exists to prevent. Each row
carries where the standard came from (`source`), free-text `notes`, the
principal who declared it and when. The set in force is the newest row whose
`effective_from` has arrived, so a standard change Avail announces ahead of
time can be declared ahead of time.

**The compiled constant stays, as the fallback default.** Same contract as
`thresholdOrDefault` in `lib/otpSettings.ts`: a missing table, a missing row or
a stored set validation would have refused all yield
`DEFAULT_OTP_MEASUREMENT_PARAMETERS`. A missing setting must never stop a
figure being produced. What it must not do is pass itself off as a declaration
— the module reports `source: "code"` when it falls back, and the console says
so.

**Every stored feed row is stamped with the parameter set it was polled
under.** A new `measurement_parameters` column on `OtpMonthlyRouteStopDay` and
`OtpDailyRouteStopHour` holds the segment string actually sent —
`2/5/10/60/0/1/1`. This is the part that matters, and three choices inside it
are load-bearing:

* **The stamp is the segments, not a foreign key to the register.** It is what
  was sent, it is readable in a view or a CSV export without a join, and it
  outlives the register row the way migration 141's ledger deliberately
  outlives the figure it describes. A pointer into a mutable table is not
  evidence.
* **The stamp is written from the set the poll actually used**, read once per
  run and passed down, not re-read per row. A run that spans a declaration
  stamps all of its rows with the set it started under, because that is the
  request it made.
* **Existing rows stay NULL, and NULL means "not recorded" — never "current".**
  The stamp is a property of a poll, and which poll last touched a given row is
  not in the database; neither is the deploy time of 1.6.39. Backfilling the
  current set onto rows polled under the old one would manufacture exactly the
  false provenance this ADR is about. Instead the register is seeded with both
  sets — `1/5/15/30/0/1/1` from the feed's start, `2/5/10/60/0/1/1` from
  2026-10-27 — so an unstamped row's standard is an inference the reader draws
  from the register and the row's `updated_at`, visibly an inference rather
  than a claim the row makes.

**A declaration is a restatement event, not an edit.** Declaring a set appends
to the OTP Audit Stream beside stop and weather-day decisions, and every
service month holding rows under a different set becomes a month needing
re-pull.

**The re-pull list is derived, not a queue.** A month needs re-pull when any of
its rows is stamped with something other than the set in force, NULL included;
re-pulling it under the current set removes it from the list. There is no
second ledger to drift out of step with the figures, and nothing to mark
resolved and forget.

**A declaration does not re-pull anything by itself.** This is the hazard the
design exists to prevent: a plain admin form that silently restated years of
contractual performance the moment somebody saved it. Declaring says what the
standard is and from when; a human runs `POST /otp-historical-backfill` for the
months they mean to restate, month by month, and the list says which those are.

**Declaring is gated behind `service-configuration.edit`**, as the rest of the
OTP Compliance admin page is, and the form will not submit until it has shown
what the declaration implies — the service months and row counts that would
fall out of agreement with the new set. Reading the register, the history and
the re-pull list needs only `compliance-review.view`, so anyone validating a
figure can see what it was measured under without being able to change it.

**`Include Outliers` is part of the set.** It stays 1, and is unchanged here.
Avail has not yet answered whether the BI report drops outlying departures from
its denominator — the likeliest explanation of the one gap left between the API
and the report, 4,271 departures on route 465 against the report's 4,045, 5.6%
more. Carrying it in the register rather than leaving it a constant means that
when the answer arrives the change is a dated declaration with a stated source,
and the denominator shift it causes is attributable to it.

## Consequences

**Tier A cannot run on the months as they stand.** 2026-05, 2026-06 and
2026-08 all hold `1/5/15/30` figures and will appear on the re-pull list the
moment migration 151 is applied. They must be backfilled under the declared set
before the comparison means anything; a figure that moves between that backfill
and the comparison is the correction, not a defect. The handoff's acceptance
standard is untouched — three months, 0.5 points, no tier change — but the
figures it compares have to be stamped `2/5/10/60/0/1/1` for the standard to
apply.

**The correction raises OTP slightly, and the re-pull will show it.** At an
early threshold of 1 minute a departure 1–2 minutes early counted as early,
where MVTA's standard counts it on time. Months re-pulled under the declared
set will read differently from what screens showed before, and the register and
the stamp are what explain the move to the contractor.

**One more thing can refuse a poll, and nothing does.** The in-force set is
read once per run from a table that may not exist; every path falls back to the
compiled constant rather than failing, so applying the migration late — or not
at all — leaves the pollers behaving exactly as they do today.

**The daily and monthly feeds are stamped from the same register.** They are
polled from different Avail operations with different parameter positions in
the path, but the same seven numbers, so one declaration governs both. ADR
0038's reconciliation between them depends on that: subtracting a daily date
from a monthly day-of-week bucket is only valid while both were measured the
same way, and the stamp now makes that checkable rather than assumed.

**The segment order is a contract with Avail, and it is asserted once.** The
register's computed column builds the same string the module sends,
and a db contract test round-trips a row to prove they agree, the way
`otpMonth/rules.test.ts` reads migration 140 and fails if code and view drift.
A reordering on Avail's side is a code change in one place.

Two things this deliberately does not do. **It does not make the parameters
discoverable from Avail.** There is no API that reports MVTA's BI
configuration, so a declaration is still somebody at MVTA writing down what
Avail told them, with the date and the source attached; the register makes the
claim auditable, not self-verifying. And **it does not restate a finalized
assessment.** A frozen assessment keeps the figure it froze (ADR 0006); the
live figure beside it moves when the month is re-pulled, and the register is
what says why — which is the same division ADR 0039 drew for an Avail
restatement.
