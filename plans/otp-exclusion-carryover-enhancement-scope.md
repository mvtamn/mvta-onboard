# Enhancement scope: carrying OTP stop exclusions across months

**Status: DRAFT, scoping only.** Nothing here is built. Written per Ty's
request after confirming (2026-08-06) that `OtpStopExclusions` is
deliberately keyed by `service_month` - an approved/rejected stop exclusion
today does **not** carry forward to next month; every month starts as a
fresh review.

## The problem worth solving

Some exclusion reasons describe a **permanent property of the stop/route**,
not a month-specific anomaly:

- `SCHED_RECOVERY` (scheduled recovery/layover)
- `TERMINAL_HOLD` (terminal/station hold)
- `NON_REVENUE` (non-revenue stop)

A stop excluded for one of these reasons will very likely need the *exact
same* exclusion every single month going forward, forever - the underlying
cause doesn't change month to month. Today, staff have to re-approve it
from scratch every month, indefinitely, with zero new judgment being
exercised - pure repeated clicking, not real review.

Other reasons are genuinely month-specific and *should* require a fresh
look each time:

- `DATA_QUALITY`, `SCHEDULE_DESIGN`, `OTHER` - these describe something
  that happened (or was investigated) in a particular month, not a
  standing fact about the stop.

Any carryover design needs to respect that distinction - it's not "all
exclusions carry forward" or "none do."

## Why this isn't a trivial schema change

`OtpStopExclusions` being keyed by `service_month` is also what makes
"Official OTP %" a durable, auditable, per-month compliance record (the
whole point of persisting it instead of ephemeral React state, per the
original OTP-completion work). Any carryover mechanism has to preserve
that - a stop's status for a given month needs to remain a real, dated,
attributable record, not something that silently retroactively applies
without ever having been reviewed *for that month* by anyone.

## Options considered

### Option A - "Copy last month's decisions" button (lowest risk)

A button on Review Queue: "Copy last month's exclusion decisions" -
pre-fills this month's candidates with last month's approve/reject +
reason for any matching `(route_id, stop_id, day_of_week)`, but still
creates a **new, real row for the current month** with its own
`reviewed_by`/`reviewed_at` once staff confirms (a single click per
candidate, or a "confirm all" action) - not a silent auto-carry.

- Keeps the exact current schema and compliance semantics - every month
  still has its own real, attributed record.
- Doesn't require classifying reason codes as "structural" vs. not - staff
  make that call implicitly by choosing what to copy vs. what to
  re-evaluate.
- Doesn't reduce the audit trail size (still one row per month per
  excluded stop) but does reduce the *clicking*, which is the actual
  complaint.

### Option B - reason-code-level "auto-carries-forward" flag

Add a column to `OtpReasonCodes` (e.g. `auto_carries_forward BIT`) that
Administration can set per code - `SCHED_RECOVERY`/`TERMINAL_HOLD`/
`NON_REVENUE` marked `true` by default, `DATA_QUALITY`/`SCHEDULE_DESIGN`/
`OTHER` marked `false`. Candidate generation would check: does a prior
month's approved exclusion exist with an `auto_carries_forward` reason for
this `(route_id, stop_id, day_of_week)`? If so, either (a) don't surface it
as a pending candidate at all, or (b) surface it pre-approved needing only
a one-click confirm.

- Removes the recurring toil entirely for the codes that actually deserve
  it, with no per-month manual copying needed.
- Bigger design commitment - changes what "no row this month" means (today
  it unambiguously means "still pending"; this would make it ambiguous
  unless the system explicitly writes a new row anyway).
- Raises a real compliance question: if a stop's exclusion auto-applies
  without a human looking at it that month, does that still count as
  "reviewed" for audit purposes? Worth a real answer before building this,
  not an assumption either way.

### Option C - do nothing structurally, just make review faster

Keep every month a fully independent decision, but add UI affordances
that make repetitive review fast without changing data model or
compliance posture at all - e.g., Review Queue could show "this same
stop/day was excluded last month for TERMINAL_HOLD" as an inline hint next
to a still-pending candidate, so approving it is a fast, informed
one-click action rather than starting from zero context.

- Zero schema change, zero new compliance question.
- Doesn't reduce the number of clicks, just makes each one faster/safer.

## Recommendation (non-binding, Ty decides)

Option A is the natural first step - it directly addresses the actual
complaint (repetitive clicking) without touching the compliance semantics
or requiring an answer to the harder "does auto-carry still count as
reviewed" question. Option B is worth revisiting later specifically for
the small set of reason codes that are genuinely permanent-by-definition,
once there's real multi-month history to see how much of the toil is
actually concentrated in those few codes vs. spread across all of them.

## Open questions before any of this gets built

1. Does compliance/audit require a real per-month reviewer action on every
   excluded stop, or is "the system carried this forward per a
   pre-approved reason-code policy" an acceptable audit story? This is the
   crux of whether Option B is even viable, independent of engineering
   effort.
2. If Option A: does "copy last month" copy the reason code verbatim, or
   should staff be required to re-select it (forcing at least a glance at
   whether it's still the right reason)?
3. Is there a need to track "this exclusion has now been approved N months
   in a row" as its own signal (e.g., to eventually promote a
   long-standing manually-approved stop into a permanent
   `RouteClassification`-style reference table instead of a recurring
   exclusion at all)?
