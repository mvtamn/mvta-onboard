# OTP Compliance — what every function does

Handoff explainer for Rob's validation against raw Avail reporting and existing OCC process.
Written 2026-09-22 against dev (v1.5.287). Companion document:
`otp-compliance-validation-plan-2026-09-22.md`.

---

## 1. The one sentence

OnBoard pulls Avail's own monthly OTP report, keeps it verbatim, and then applies **two
documented subtractions** — non-fixed-route service, and stop/day exclusions a human
approved — to produce the number the contractor is assessed on. Everything else in the
module exists to make those two subtractions visible, reviewable and auditable.

Three figures travel together everywhere, and they are the spine of this handoff:

| Figure | Meaning | Who should agree with it |
| --- | --- | --- |
| **Raw** | Avail's numbers, untouched | Avail's own OTP report for the same month |
| **Excluded** | What the two rules removed | The Review Queue decisions + Route Classification |
| **Assessable** (shown as "Official Departure OTP") | Raw minus Excluded | The contractor scorecard and Power BI |

Raw − Excluded = Assessable, by construction, at every level (stop, route, agency).

---

## 2. Where the numbers come from

**Source:** Avail360 report `OtpByRouteStopDayAgg` — "OTP Monthly By Route/Stop/Day of
Week". OnBoard does not compute OTP. It does not look at AVL pings, GTFS-RT or scheduled
times to decide on-time. It takes Avail's early/on-time/late/missed counts per
route × stop × day-of-week and stores them.

**This is departure-based OTP.** Not arrival. The manual's Section 17 notes a week where
departure and arrival OTP differed by up to 36 points on a route, so the distinction
matters when reconciling against anything else.

**Grain:** one row per service month × route × stop × day of week. There is **no calendar
date** in this feed — "Tuesdays in July", not "July 14". That single fact drives the
weather-exclusion limitation in §6.

**Collection:** a timer runs daily at 03:00 UTC and re-pulls the current month plus the
prior two, upserting in place. A month Avail populates late self-heals within a day. Months
older than that window are filled by the admin backfill button, one month per request.

**Second, unofficial feed:** `OtpByRouteStopDayHour` (daily/hourly) is polled at 12:00 UTC,
kept 90 days, and is explicitly **not** the compliance record — its field mapping was never
confirmed against a documented Avail response. It carries `IsOfficialRecord = 0` in the
reporting layer and no console page uses it. Do not let it near a compliance figure.

---

## 3. The two subtractions, stated exactly

### Subtraction A — Route Classification

Only routes classified **FixedRoute** count. Special-event, on-demand and non-revenue
service is outside the fixed-route contractor's regular obligation.

A route with **no classification row counts as fixed route**. This is deliberate: a new
route falls under the standard by default rather than silently escaping it. Classification
is maintained at *Administration → Service Configuration* (route classification editor),
because no Avail feed carries the distinction.

On dev today: 8 SpecialEvent, 4 NonRevenue, 1 OnDemand classified; everything else is
fixed route by default.

### Subtraction B — Approved Stop Exclusions

A stop, on one route, on one day of the week, in one month, that a reviewer **approved**
with a reason code is removed from the assessable figure. Matching is on all four keys —
month + route + stop + day-of-week — exactly as the feed is grained.

A **rejected** decision changes nothing arithmetically. It is recorded so the audit trail
shows the stop was looked at and deliberately kept in.

Nothing else is subtracted. There is no smoothing, no outlier trimming, no weather removal
(see §6), no per-trip judgement.

### The target

85% (`OTP_FIXED_ROUTE`, Attachment G), read in this order: the month's **frozen assessment
period rule set** if the month has one → the current standards catalog → 85% hardcoded
default. The console states which of the three answered. A finalized month is judged by the
rules frozen at finalization, so editing a band today cannot restate a closed month.

---

## 4. The six reviewer pages (Compliance → OTP Compliance)

Access: `compliance-review.view` to read, `compliance-review.review` to approve or reject.

**Dashboard** — portfolio stat tiles, an agency OTP % trend chart (plots the *assessable*
figure, with raw alongside), and the recent review timeline.

**Review Queue** — the work surface. Lists **Flagged Stops**: any fixed-route stop/day row
whose early share *or* late share exceeds the **Early/Late Bias Threshold** (0.15 = 15% of
departures on dev). Being flagged decides nothing — the row still counts in full until
someone approves an exclusion.

For each candidate: route, stop, day, trips sampled, an early/on-time/late/missed strip, a
reason-code dropdown, **Approve** and **Reject**. Where the same stop/day was decided last
month, the prior decision is shown with a **Copy last month** button, and a banner offers
**Copy all matching**. Copying writes a fresh, dated row for the current month with the
current reviewer's name — it is not a silent carry-forward.

Already-approved stops stay visible in the queue so a past decision can be seen and
reversed; re-reviewing upserts in place.

**Route Summary** — per route: departure events, Raw OTP %, Official OTP %, Δ from
exclusions in points, and Meets/Below vs. the target. This is the page that answers "which
routes moved, and by how much, and why".

**Weather Exclusions** — log agency-wide or route-specific weather/emergency service days
with a reason code and notes. **Read §6 before trusting this page.**

**Monthly Assessments** — the locked snapshot. If the month has an assessment period, it
shows the figure the contractor was actually shown, with its tier and period status, and
says plainly that it is not recalculated. If not, it shows today's live figure labelled
*Provisional*.

**Audit Stream** — one merged timeline of every stop-exclusion and date-exclusion action,
built by querying the records themselves rather than a separate log table, so it cannot
drift from what actually happened.

---

## 5. The three admin functions (Administration → OTP Compliance)

Gated separately (`service-configuration.edit` / OCC.Admin) because these settings change
every reviewer's queue.

1. **Reason codes** — the dropdowns for stop exclusions, date exclusions and missed-trip
   outcomes. Dev has 6 of each. Codes are soft-deleted (deactivated), never hard-deleted,
   so historical rows keep their meaning.
2. **Early/Late Bias Threshold + tuner** — preview a trial threshold against the current
   month's real rows before applying it. The preview asks the server for the flagged set at
   the trial value rather than re-implementing the rule in the browser.
3. **Historical backfill** — pull a past month from Avail, one month per request (a
   multi-month request 504s behind the gateway). Idempotent; re-running a covered month is
   harmless.

---

## 6. Limitations to state out loud before Rob starts

These are real, current, and each is a deliberate decision rather than a bug:

1. **Weather/date exclusions are recorded but never applied to the figure.** Avail's
   monthly feed is keyed by day of week, not date, so a single snow date cannot be removed
   from it. The console reports the count of recorded weather days so a reviewer is told
   rather than left guessing. If MVTA's existing process expects a snow day to move the
   number, **that gap is the single biggest thing to settle with Rob.**
2. **"Contractor notified / acknowledged" on the Weather page is display-only.** The flags
   exist in the table and render, but nothing in OnBoard sets them and no notification is
   sent anywhere. Today it is a manual, off-system step.
3. **No average seconds variance.** The live feed has no such field; the queue infers
   "Early-biased"/"Late-biased" from the shares instead. Any mock row showing "164s early"
   is sample data.
4. **Sample/mock fallback exists.** When a month has no feed rows, pages fall back to
   preview data and label it "Sample data". Rob should never validate against a page that
   says that.
5. **Departure-based only**, per §2.
6. **The daily feed is unofficial and 90-day**, per §2.

---

## 7. What Rob can query directly

The Power BI reporting layer is the intended reconciliation surface — it publishes the rule
rather than re-implementing it.

- `vw_OtpMonthlyRouteStop` — one row per month/route/stop/day with `IsAssessable`,
  `IsStopExcluded`, the exclusion's reason code, approver and approval time, plus every raw
  count. **Summing `OnTimeDepartures / TotalDepartures` where `IsAssessable = 1` reproduces
  the official figure exactly**; dropping the filter gives raw. The exclusion is exposed,
  not applied, so both numbers reconcile from one view.
- `vw_OtpDailyRouteStopHour` — trending only, `IsOfficialRecord = 0`.
- `vw_ScorecardKpi` / `vw_ScorecardPeriod` — the assessed layer (finalized periods, tiers,
  penalties).
- `vw_MeasurementFeedHealth` — whether the feeds are current.

A contract test in CI reads the migration and fails the build if the view's `IsAssessable`
expression and the application's rule ever drift apart, so the two cannot silently diverge.

---

## 8. Dev state as of 2026-09-22 (Rob's starting picture)

| Service month | Raw departures | Raw OTP % | Assessable OTP % | Δ |
| --- | --- | --- | --- | --- |
| 2026-01 | 62,214 | 88.33 | 88.33 | — |
| 2026-02 | 59,348 | 88.61 | 88.61 | — |
| 2026-03 | 69,196 | 88.14 | 88.14 | — |
| 2026-04 | 71,317 | 86.93 | 86.93 | — |
| 2026-05 | 70,069 | 85.80 | 85.80 | — |
| 2026-06 | 67,888 | 84.42 | 84.42 | — |
| 2026-07 | 65,458 | 83.28 | 83.32 | +0.04 |
| 2026-08 | 65,278 | 83.62 | 83.62 | — |
| 2026-09 | 39,811 | 80.19 | 80.27 | +0.08 (month in progress) |

Also present: 6 approved and 3 rejected stop exclusions (July and September only), 0 date
exclusions, threshold 0.15, target 0.85, two assessment periods (202601, 202608) both in
`stale` status.

The small deltas are the point: with 9 approved exclusions across 9 months, the official
figure moves by hundredths of a point. If Rob's process expects exclusions to move OTP by
whole points, either the review volume or the expectation needs revisiting — that is a
process conversation, not a defect.
