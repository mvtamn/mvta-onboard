# ADR 0038: Subtract an approved weather date from a monthly figure

Status: accepted (2026-09-22)

## Context

ADR 0033 recorded that a weather or emergency date cannot be removed from
fixed-route OTP. The reasoning was structural rather than reluctant: Avail's
monthly feed, `OtpByRouteStopDayAgg`, is keyed by service month, route, stop
and **day of week**. A row is "every Monday in September". There is no date in
it, so "the 7th" has nothing to bind to.

`OtpDateExclusions` has existed since migration 018 to record the dates anyway,
and the console's Weather page said plainly that they were kept for the record
and not applied. In practice the feature was further from working than that:
the table defaults `status` to `'Proposed'`, has no `approved_by`/`approved_at`,
and the API offered only GET and POST. No row could reach the `'Approved'`
state `measureOtpMonth` looks for. Every weather day ever entered went into a
state nothing read.

What changed is evidence, not appetite. The daily feed
(`OtpDailyRouteStopHour`, migration 020) does carry a real `CalendarDate`, but
carried a standing caveat that its field mapping had never been confirmed
against a documented Avail response, so it is published as
`IsOfficialRecord = 0` and no console page reads it.

On 2026-09-22 the two feeds were compared directly on dev. They are polled from
different Avail operations and key routes on different fields - `RouteID`
monthly, `RouteFareboxID` daily - and they agree exactly:

* the same 19 routes for September, the same labels, and all 86 stops shared;
* September's monthly feed covers service days 1-20, and subtracting daily
  2026-09-14 from the monthly `Mon` bucket leaves a residual that is **exactly
  zero on every weekday-only route**;
* the residual is non-zero only on the eight routes that run a Sunday schedule,
  and it matches each one's actual Sunday volume - Labor Day, 2026-09-07,
  running Sunday-level service (436: 78 vs 78, 442: 60 vs 60, 446: 78 vs 78).

Eleven exact zeroes is not approximate agreement between two aggregates. A
single calendar date can be isolated from a monthly figure.

## Decision

An **approved** date exclusion subtracts that date's departures from the
month's assessable figure. Four things fix what that means.

**The subtraction lands on assessable only. Raw is untouched.** Raw stays what
Avail published, which is the number the agency reconciles against Avail's own
report, and `Raw - Excluded = Assessable` still holds. A date exclusion is a
third subtraction alongside the route-category filter and approved stop
exclusions, and the measurement now reports the three apart - `stop_excluded`
and `date_excluded` beside the combined `excluded` - because a reviewer asking
why a route moved is owed the difference between "a stop came out" and "a snow
day came out".

**The date's departures are frozen on approval, not recomputed.** Approving
writes `OtpDateExclusionDepartures`: one row per route and stop, at the grain
the monthly feed is measured on, with the Avail day-of-week spelling in force
when it was taken. The measurement subtracts that snapshot. Three reasons, each
load-bearing:

* the daily feed purges at 90 days and holds nothing before 2026-09-14, so a
  live subtraction would quietly stop subtracting once a date aged out, and an
  assessed figure would move on its own;
* a dispute is about what was taken out, not what Avail says today - a frozen
  row is evidence, a recomputation is an opinion;
* Avail restates.

**An approval that cannot be evidenced is refused, not recorded.** If the daily
feed holds nothing for the date, or the month has no rows for that day of week,
or no route on the date matches a row in the month, the transaction rolls back
and the reviewer is told which of the three it was. The alternative - an
approved exclusion that subtracts nothing - is the exact failure mode the
Weather page has had since migration 018, where the reviewer sees an approval,
the contractor sees an unchanged figure, and nothing on screen explains the
gap.

**The subtraction clamps at zero.** A snapshot larger than the row it subtracts
from means the monthly feed was restated downward after approval. Clamping
fails toward keeping departures in the contractor's figure rather than
inventing negative ones.

## Consequences

The rule is declared once, in `lib/otpMonth/rules.ts`, and
`vw_OtpMonthlyRouteStop` publishes the same expressions verbatim;
`rules.test.ts` reads migration 140 and fails if the two drift. The view's
reporting contract changes: a report sums `AssessableTotalDepartures` and
`AssessableOnTimeDepartures` rather than filtering on `IsAssessable`, because a
date exclusion reduces a row rather than removing it. `IsAssessable` stays, and
summing the old way still answers the question it always answered - the figure
before weather.

Day-of-week spellings become load-bearing. Avail writes `Tues` and `Thur`, not
`Tue` and `Thu`, and a near-miss subtracts nothing silently. `AVAIL_DAY_OF_WEEK`
names them, and the approval path checks its derived value against the month's
own rows before writing anything, so a change on Avail's side refuses an
approval instead of quietly zeroing it.

Dates before 2026-09-14 cannot be excluded in the system at all, and dates older
than the daily feed's retention will lose that ability as they age out. Whether
to extend retention is a separate decision; the snapshot means an already
approved date is unaffected by it.

Two things this deliberately does not do. It does not exclude holidays: Labor
Day's reduced service sits inside September's Monday bucket and skews every
day-of-week reading, including the Review Queue's bias flagging, but what a
holiday is worth is a contract question rather than a code one. And it does not
notify anybody - the Weather page's "notified"/"acknowledged" flags are still
display-only, and nothing in OnBoard sets them.
