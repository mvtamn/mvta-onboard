# 35. Promote a detector on a service date, and keep the decision

Date: 2026-09-18

## Status

Accepted

## Context

Missed-trip detectors run in Shadow detection: they open cases, Operations
reviews them, and a confirmation is deliberately not handed to occurrence intake
until the detector is promoted. CONTEXT sets the bar - a complete service week at
95 percent precision, and more for on-demand - but nothing recorded whether the
bar had been met, or when.

Promotion was `MISSED_TRIP_PROMOTED_DETECTORS`, an app setting holding a
comma-separated list of detector families. Three things were wrong with it.

1. **It had no date.** The setting said a detector *is* promoted, not *since
   when*, so the day it changed, every case the detector had ever opened started
   counting - including confirmed cases in months already measured, already
   reviewed, possibly already issued. Promotion silently rewrote history.
2. **It kept no reason.** Nothing recorded the measured precision, the sample it
   was measured on, or who decided. The one fact a contractor would challenge -
   "on what evidence did this detector start costing us money?" - existed only in
   somebody's memory.
3. **SQL could not read it.** `vw_MissedTrip` therefore had to report every
   detector as unpromoted, so the warehouse and the app disagreed by design as
   soon as anything was promoted.

Only seven reviews exist in the whole system, and nothing has ever been
promoted, so there is no history to preserve - but the same is true of the
evidence a first promotion will rest on, which is exactly what should be written
down when it happens.

## Decision

Promotion is a decision with a date, stored in an append-only history
(`MissedTripDetectorPromotions`, migration 134). Each entry names the detector
family, the **service date** it takes effect from, whether it promotes or
demotes, the reason, the measured precision and sample size it was decided on,
and who decided.

A case counts toward an assessment when its detector was promoted on the service
date the case belongs to. The latest decision at or before that date wins.

This follows from the three faults above:

- **Dated, by service date.** Not the date the decision was entered: a promotion
  effective the first of next month is the natural way to say "count it from the
  next measured month", and one effective last month is a deliberate, visible
  choice rather than a side effect of saving a setting. A month already measured
  only changes if somebody backdates a promotion into it, and says why.
- **Demotion is the same record, not a deletion.** A detector that starts
  misfiring is demoted from a service date; the months it was trusted for keep
  counting as they did. Removing a name from a list would have erased them.
- **Append-only.** The history is the audit trail. Nothing is updated in place,
  so a decision and its reversal both survive.

Readers do not query the history table. The module compiles it into the spans
each detector was promoted for and renders those spans as literals
(`promotionWindows` / `promotionWindowsSql`), so every query carries its own
answer, a database without migration 134 behaves exactly as the app did before -
nothing promoted, which is Shadow detection - and there is no ordering hazard
between deploying the code and applying the migration.

`vw_MissedTrip` is the one exception: nothing regenerates a view when a
promotion is recorded, so the view reads the history table directly. The two
renderings are proven equal against real rows by the module's contract test, so
the warehouse agrees with the app by construction rather than by discipline.

## Consequences

- Promotion is now an operational decision somebody makes and signs, not a
  deployment setting. It needs a surface to make it on; until that ships it is a
  row inserted by hand, which is already better than a setting nobody recorded.
- `MISSED_TRIP_PROMOTED_DETECTORS` is gone. The setting is unset everywhere, so
  nothing changes on any environment when this ships: an empty history and an
  empty list mean the same thing.
- Backdating a promotion into a closed month is possible and deliberate. It is
  visible in the history with a reason, and the assessment module's material
  change rules decide what happens to a month it touches.
- A detector name the history mentions that the build does not know promotes
  nothing, and is reported rather than ignored, so a typo cannot look applied.
