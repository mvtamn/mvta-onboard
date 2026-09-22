# OTP Compliance — validation & test plan

For Rob's validation against raw Avail reporting and existing OCC process.
Written 2026-09-22 against dev and revised the same day for what shipped after the first
draft. Current to **v1.5.295**. Read `otp-compliance-explainer-2026-09-22.md` first.

**How to use this:** work the tiers in order. Tier 1 decides whether the numbers are
trustworthy at all — if it fails, nothing below it matters. Tier 4 is the part only Rob can
answer, and it is the real reason for this handoff.

Record each case as **Pass / Fail / Needs discussion**, with the two numbers compared.

---

## Start here

**Tier 2 has already been run and passed.** You do not need to repeat it. What is left for
you is Tier 1 — which needs Avail's own export and nobody else can do — plus Tiers 3 and 4.

**Four steps, in order:**

1. **Pull two reports from Avail**: *OTP Monthly By Route/Stop/Day of Week*
   (`OtpByRouteStopDayAgg`) for **2026-07** and **2026-08**. Get them at route level, and at
   route/stop/day-of-week level for at least route 490.
2. **Work Tier 1** (below). This is the whole point of the handoff: does OnBoard hold what
   Avail published? Everything else assumes it does.
3. **Work Tier 3** with whoever runs the OCC review process day to day.
4. **Bring Tier 4 to a conversation with Ty.** Those are decisions, not tests.

**What to send back:** for each case, Pass / Fail / Needs discussion, and where a number
differs, both numbers with the month and route. A Tier 1 or Tier 2 failure is a defect worth
logging. Tier 3 failures are usually configuration. Tier 4 outcomes are decisions to record.

**Two things to know before you start.**

*The system changed on 2026-09-22, after this plan was first written.* Weather days now
actually subtract from the figure, they can be approved from the console, and a restatement
of a closed month is recorded. The cases below reflect the system as it is now. If anything
reads as though weather is inert, that text is stale — tell us.

*Ignore any page that says "Sample data".* That is mock preview shown when a month has no
feed rows, and it is not the live figure.

---

## Before starting

| Item | Value |
| --- | --- |
| Environment | dev (the only OnBoard environment) |
| Console | Compliance → OTP Compliance; Administration → OTP Compliance |
| Access needed | `compliance-review.view` + `compliance-review.review`; `service-configuration.edit` for the admin page |
| Reference months | **2026-07** (has approved + rejected exclusions) and **2026-08** (clean, complete) |
| Never validate a page reading | "Sample data" — that is mock preview, not the feed |

Rob needs, from Avail directly: the **OTP Monthly By Route/Stop/Day of Week**
(`OtpByRouteStopDayAgg`) report for 2026-07 and 2026-08, at route level and at
route/stop/day level for at least one route.

---

## Pre-run results (2026-09-22, run against dev by Claude)

Everything that could be settled without Avail's own export has been run. What remains for
Rob is **Tier 1's external comparison** — the part only he can do — and Tier 3/4.

| Case | Result | Evidence |
| --- | --- | --- |
| T1.1–T1.3 source fidelity | **Not runnable internally** | Requires Rob's Avail export. This is the real handoff task. |
| T1.4 restatement detection | **Was a defect; fixed 2026-09-22** | See F1 below |
| T1.5 backfill idempotency | Not run (would write to dev) | Idempotent by construction (MERGE on the natural key) |
| Feed health | **Pass** | `avail_otp_monthly` last success 2026-09-22 03:01, 2,672 records; `avail_otp_daily` 12:01, 3,783. No failures recorded. |
| T2.1 Raw − Excluded = Assessable | **Pass** | All 9 months reconcile exactly, agency and route level |
| T2.2 view reproduces the app rule | **Pass** | 197 route-months compared, **0 mismatches** |
| T2.3 only approved exclusions subtract | **Pass** | 6 approved → 6 rows excluded; 3 rejected → 0 excluded; no orphaned decisions |
| T2.4 classification filter | **Untested by real data** | See F2 below |
| T2.5 exclusion arithmetic | **Pass** | 202607 excluded exactly 175 departures / 119 on-time; 202609 exactly 79 / 34 — matching the approved stops precisely |
| T2.6 target provenance | **Pass** | 202601 and 202608 read a frozen period rule set; all other months read the catalog. Every path resolves to 0.85. |

The measurement rule is sound. Tier 2 passed without qualification: the number the console
shows, the number the assessment stores and the number Power BI publishes are provably the
same number.

### Findings

**F1 — OnBoard could not detect or evidence an Avail restatement. FIXED 2026-09-22.**
The monthly upsert set `updated_at = SYSUTCDATETIME()` on every match, whether or not any
value changed, so every row in the trailing window carried today's timestamp after every
nightly poll. If Avail silently restated a closed month, OnBoard adopted the new figure with
no record that it changed.

`updated_at` now moves only when the row says something different, and a change to a month
that is already over is recorded in `vw_OtpRestatement` with both figures and both deltas
(ADR 0039, migration 141, applied). See T1.4 for how to read it.

**F2 — Subtraction A has never fired.** All 13 classified routes (8 SpecialEvent, 4
NonRevenue, 1 OnDemand) carry **zero** OTP rows, so the fixed-route filter has never actually
removed anything. Every route in the feed is FixedRoute. The rule is correct and tested in
CI, but it has no production evidence. Rob should classify one live route temporarily,
confirm it leaves the official figure, and remove the classification.

**F3 — A one-record variance in the nightly ledger, unexplained.** The 2026-09-22 run
recorded 2,672 records stored; the three trailing months hold 2,673 rows, all stamped by
that run. No orphaned rows exist. It moves no figure, but it is unreconciled — Rob's T1.2
route-level comparison will settle whether Avail published 2,672 or 2,673.

**F4 — The daily feed reconciles exactly with the monthly feed.** See the section below.
This is the finding that unblocked weather exclusions, which shipped the same day
(ADR 0038, migration 140, applied).

### F4 in full — the daily feed is trustworthy, and dates can be subtracted

`otpDailyFeed.ts` carries a standing caveat that its field mapping was "KNOWN UNCONFIRMED —
more so than any other feed in this project", which is why the daily data is marked
`IsOfficialRecord = 0`. That caveat can now be closed on evidence.

The two feeds are polled independently, from different Avail operations, with different
identifier fields (`RouteID` monthly, `RouteFareboxID` daily). They agree exactly:

- Same 19 routes for September, same labels, and **all 86 stops shared** — the identifier
  spaces are identical.
- September's monthly feed covers service days 1–20. Subtracting the daily feed's Monday
  2026-09-14 from the monthly Monday bucket leaves a residual that is **exactly zero for
  every weekday-only route**, and non-zero only for the 8 routes that run a Sunday schedule.
- That residual is Labor Day, 2026-09-07, running Sunday-level service — and it matches each
  route's actual Sunday volume closely (436: 78 vs 78, 442: 60 vs 60, 446: 78 vs 78,
  445: 98 vs 100, 447: 54 vs 51). Agency residual 1,043 vs Sunday 1,003.

Exact zero residuals across eleven routes is not approximate agreement. It means a single
calendar date's departures can be isolated from a monthly figure and subtracted correctly —
which is precisely the mechanism weather exclusions were said to be impossible without.

It also exposes a distortion nobody has been looking at: **Labor Day's reduced service is
pooled into September's Monday bucket**, dragging the Monday day-of-week figure away from a
normal Monday. Every holiday does this. Any day-of-week reading — including the Review
Queue's early/late bias flagging, which is computed per day of week — is affected.

---

## Tier 1 — Source fidelity: is OnBoard holding what Avail published?

The whole system rests on this. Nothing downstream can be right if it fails.

**T1.1 — Agency totals match Avail, month 2026-08**
Compare OnBoard's raw agency figure to Avail's own report for the same month.
*Expected:* 65,278 total departures, 54,588 on time, 83.62% raw.
*Watch for:* any difference at all. A small one is not rounding — it means the poll caught
the month at a different moment than Rob's export, so re-pull both and compare again.

**T1.2 — Route-level totals match Avail, month 2026-08**
Every route's departures and on-time count, OnBoard vs. Avail.
*Expected:* exact match on every route. *Watch for:* routes present in one and not the
other — that is the classification/ID-mapping question, not a counting question.

**T1.3 — Stop/day grain matches for one route**
Pick route 490 (it carries most of the exclusions). Compare every stop × day-of-week row.
*Expected:* same row count, same counts per row.
*Watch for:* day-of-week spellings. The feed stores Avail's own strings and dev holds
`Thur` and `Tues` as well as `Wed`/`Fri`. An exclusion only matches if the spelling matches
exactly, so a spelling change on Avail's side is a silent failure mode worth confirming.

**T1.4 — A re-poll does not change a closed month**

**This became answerable on 2026-09-22 (migration 141).** It was not before: the upsert
stamped `updated_at` on every poll whether or not a value had changed, so a restatement and
a no-op re-poll looked identical. Now `updated_at` moves only when the row actually changes,
and a change to a month that is already over is recorded.

```sql
SELECT ServiceMonth, RouteId, StopId, DayOfWeek,
       PreviousTotalDepartures, NewTotalDepartures, TotalDepartureDelta,
       PreviousOnTimeDepartures, NewOnTimeDepartures, OnTimeDepartureDelta,
       DetectedAt, DaysAfterMonthEnd
FROM dbo.vw_OtpRestatement
ORDER BY DetectedAt DESC;
```

*Expected:* empty, if Avail does not restate. **An empty result after a few weeks is the
answer to this case, not a missing test.**

*Watch for:* rows with a large `DaysAfterMonthEnd`. A day or two is the month's own tail
arriving — Avail publishes a service day after it ends. Weeks later is a genuine restatement,
and it means an assessed figure and the live figure beside it have diverged.

*Limit worth knowing:* this only works forward. The ledger starts from the first poll after
2026-09-22, so nothing can be said about whether Avail restated anything before that.

**T1.5 — Backfill produces the same numbers as the poll**
Administration → OTP Compliance → backfill 2026-06. *Expected:* figures unchanged after the
run (it is an upsert of identical data).

---

## Tier 2 — Rule correctness: are the two subtractions doing exactly what is documented?

**This whole tier has already been run against dev and passed, apart from T2.4.** Each case
is stamped with its result. They are kept in full so you can see what was checked, and
re-run anything you want to see for yourself — but the only one that needs you is **T2.4**.

**T2.1 — Raw − Excluded = Assessable**
> **Already run 2026-09-22 against dev: PASS.** All nine months reconcile exactly, agency
> and route level. Nothing to repeat — read on only if you want to see it yourself.

Route Summary, 2026-07. *Expected:* for every route, and for the agency line, the three
figures reconcile and the Δ column equals the difference in points.

**T2.2 — The reporting view reproduces the console**
> **Already run 2026-09-22 against dev: PASS.** 197 route-months compared between the
> application's rule and the view, **0 mismatches**. Nothing to repeat.

**The contract changed on 2026-09-22 (migration 140).** A weather-day exclusion *reduces* a
row rather than removing it — the row is every Monday, and only one Monday came out — so a
boolean flag cannot carry it. Sum the assessable columns; do not filter on `IsAssessable`:

```sql
SELECT ServiceMonth,
  SUM(TotalDepartures) RawTotal,
  SUM(OnTimeDepartures) RawOnTime,
  SUM(AssessableTotalDepartures)  AssessTotal,
  SUM(AssessableOnTimeDepartures) AssessOnTime,
  SUM(DateExcludedDepartures)     WeatherRemoved
FROM dbo.vw_OtpMonthlyRouteStop
WHERE ServiceMonth IN ('202607','202608')
GROUP BY ServiceMonth;
```

*Expected:* 202607 → 83.28% raw / 83.32% assessable; 202608 → 83.62% / 83.62%, and
`WeatherRemoved` zero on both until a weather day is approved. These must equal the
console's Route Summary figures to the digit.

*Also worth knowing:* `SUM(CASE WHEN IsAssessable=1 THEN ...)` — the old form — still
answers a real question, **the figure before weather**. It is kept deliberately so the two
can be compared. Just do not mistake it for the official number.

**T2.3 — Only approved exclusions subtract**
> **Already run 2026-09-22 against dev: PASS.** 6 approved decisions removed 6 rows, 3
> rejected removed none, and no decision was orphaned. Nothing to repeat.

2026-07 has 3 approved and 3 rejected decisions. *Expected:* exactly the 3 approved rows
appear as `IsStopExcluded = 1`; the rejected stops still carry their full departures into
the assessable figure.

**T2.4 — Classification filter**
> **Already run 2026-09-22 against dev: NOT PROVEN — this one is yours.** All 13 classified
> routes carry zero OTP rows, so the fixed-route filter has never actually removed anything.
> The rule is correct and covered in CI, but it has no production evidence. Do the temporary
> classification below.

Confirm every SpecialEvent / OnDemand / NonRevenue route is `IsAssessable = 0`, and that an
unclassified route is assessable.
*Expected:* on dev these classified routes contribute no OTP rows at all, so the filter is
currently untested by real data — worth creating one temporary classification on a live
route, checking it drops out of the official figure, then removing it. (This is exactly
what the route-classification delete exists for.)

**T2.5 — Approving an exclusion moves the figure by the right amount**
> **Already run 2026-09-22 against dev: PASS.** 2026-07 excluded exactly 175 departures and
> 119 on-time; 2026-09 exactly 79 and 34 — matching the approved stops precisely. Worth
> doing once by hand anyway if you want to watch the figure move.

Note a flagged stop's departures and on-time count. Approve it. Re-read Route Summary.
*Expected:* that route's assessable total drops by exactly that stop/day's departures, and
the official % recomputes to the new ratio. Then reject it back and confirm the figure
returns.

**T2.6 — Target provenance**
> **Already run 2026-09-22 against dev: PASS.** 202601 and 202608 read a frozen period rule
> set; every other month reads the catalog. All paths resolve to 0.85. Nothing to repeat.

Route Summary states where the target came from. *Expected:* "catalog" at 85% for months
with no active assessment period; a finalized month shows the frozen period figure.

---

## Tier 3 — Workflow: does the review process behave as OCC would run it?

**T3.1 — Flagging rule** — with the threshold at 0.15, a stop appears in the queue if
early% > 15 **or** late% > 15, fixed route only. Verify one flagged and one just-below stop
against the underlying percentages.

**T3.2 — Threshold tuner** — Administration → preview at 0.10 and 0.25. *Expected:* the
previewed count changes sensibly and the reviewer queue does **not** change until Apply.
After applying, the queue matches the preview. **Set it back to 0.15 afterwards.**

**T3.3 — Reason codes are required and recorded** — approve with a reason; confirm the code
and label appear in the Audit Stream and in `ExclusionReasonLabel` in the view.

**T3.4 — Reviewer identity and time** — confirm `ExclusionApprovedBy` / `ExclusionApprovedAt`
show the actual signed-in reviewer and a correct Central time.

**T3.5 — Copy last month** — on 2026-09, use "Copy last month" for a stop decided in
2026-08. *Expected:* a new September row with today's date and the current reviewer, not a
copy of August's timestamp.

**T3.6 — Re-review reverses cleanly** — approve, then reject the same stop/day.
*Expected:* one row, updated in place, and the figure returns to its pre-approval value.

**T3.7 — Audit Stream completeness** — every action taken in T3.1–T3.6 appears, in order.

**T3.8 — Permissions** — a viewer with `compliance-review.view` but not `.review` can see
the queue and cannot approve; the Administration page is refused entirely.

**T3.9 — Frozen months do not restate** — on a finalized month, approve a new exclusion.
*Expected:* Monthly Assessments still shows the figure the contractor was shown, labelled as
not recalculated, while Route Summary shows today's live figure. **This divergence is
intentional — confirm Rob agrees it is the right behaviour**, because it is the mechanism
that stops a closed assessment moving under the contractor's feet.

---

## Tier 4 — Process fit: the questions only Rob can answer

These are not pass/fail. They are the decisions the handoff exists to surface.

**T4.1 — Weather days.** OnBoard could not remove a weather date from the figure, and could
not even approve one. It can now, live on dev since 2026-09-22 (ADR 0038, migration 140):
an approved date subtracts the departures it carried, frozen at approval, on the evidence in
F4, and it is approved from the Weather page. What remains is Rob's to
decide: how does MVTA's existing process handle a snow day today, who approves one, and does
the contractor see the adjustment before the month is assessed? Note two limits — a date
before 2026-09-14 cannot be evidenced from the daily feed, and holidays are deliberately not
excluded.

**T4.2 — Contractor notification.** The Weather page shows "notified / acknowledged" but
OnBoard sends nothing and sets nothing. Is notification a manual step today, and should
OnBoard own it?

**T4.3 — Departure vs. arrival OTP.** OnBoard measures departures. Does the contract, and
does existing reporting, measure the same thing? The manual records a 36-point divergence on
one route in one week.

**T4.4 — Exclusion volume.** 9 decisions across 9 months move the figure by hundredths of a
point. Does that match how often OCC believes recovery/layover stops distort the number —
or is the queue under-reviewed?

**T4.5 — Route classification ownership.** An unclassified route counts as fixed route by
default. Who confirms new Avail RouteIDs are classified before a month closes?

**T4.6 — Reason code list.** Are the 6 stop and 6 date codes the vocabulary OCC and the
contractor actually use in disputes?

**T4.7 — Measurement points.** Avail decides what counts as on time (its own threshold and
outlier settings). Are those settings the governed ones in the contract, and who at MVTA
holds that?

---

## Sign-off

| Tier | Owner | Result | Date |
| --- | --- | --- | --- |
| 1 — Source fidelity | Rob | | |
| 2 — Rule correctness | Rob | | |
| 3 — Workflow | Rob + OCC | | |
| 4 — Process fit | Rob + Ty | | |

A Tier 1 or Tier 2 failure is a defect — log it with the month, route and both numbers.
Tier 3 failures are usually configuration. Tier 4 outcomes are decisions to record, not
bugs to file.
