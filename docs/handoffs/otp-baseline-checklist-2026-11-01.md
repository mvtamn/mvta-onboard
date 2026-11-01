# OTP baseline checklist — from here to a signed-off system of record

**Date opened:** 2026-11-01. **Companion to**
`otp-system-of-record-closeout-2026-10-31.md` (the steps and who owns them) and
`otp-compliance-validation-plan-2026-09-22.md` (the test cases).

**This is a working checklist, not a report.** Tick items in place, write the figure you
got next to the figure expected, and date the row. Every item names an owner, the exact
query or page that proves it, and what "done" looks like, so it can be picked up by
somebody who was not in the conversation.

> **Where the closeout document lives.** `otp-system-of-record-closeout-2026-10-31.md` is
> on branch `avail-march-duplicates` (PR #460) and not yet on `main`. This checklist does
> not restate it; read both. Nothing here edits the validation plan either — its T2.4 stamp
> still reads "NOT PROVEN", and item 1a below is the result that supersedes it. Stamp the
> plan when #460 lands, so the two do not conflict.

**Status at open:** step 1 of the closeout is complete. Four items below are ticked with
their evidence. Everything still open needs Rob, OCC, or a decision — nothing left on this
list is a build.

---

## The figures this checklist is measured against

Raw agency OTP, all on `2/5/10/60/0/1/1`, read from `dbo.vw_OtpMonthlyRouteStop` on
2026-11-01 **after** September's test decisions were cleared (item 1b):

| Month | Raw % | Departures | Assessable % | | Month | Raw % | Departures | Assessable % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-01 | 90.63 | 61,203 | 90.63 | | 2026-06 | **85.92** | 65,284 | 85.92 |
| 2026-02 | 90.96 | 58,328 | 90.96 | | 2026-07 | 84.86 | 64,411 | 84.91 |
| 2026-03 | 90.50 | 67,330 | 90.50 | | 2026-08 | **85.30** | 62,748 | 85.30 |
| 2026-04 | 89.13 | 68,582 | 89.13 | | 2026-09 | 81.20 | 62,538 | **81.20** |
| 2026-05 | **87.56** | 67,532 | 87.56 | | 2026-10 | 83.93 | 65,956 | 83.93 |

Bold months are the three decision months. **September's assessable figure now equals its
raw figure** — it read 85.27% until 2026-11-01, on test decisions that have been cleared.
Only 2026-07 carries genuine exclusions, worth 0.05 points.

2026-10 is this list's first full read of October and supersedes the 63,443 / 83.78 in the
closeout, which was taken mid-month.

```sql
-- The one query behind that table. Sum the assessable columns; do not filter
-- on IsAssessable (migration 140 — a weather day reduces a row, it does not remove it).
SELECT ServiceMonth,
  SUM(TotalDepartures) RawTotal, SUM(OnTimeDepartures) RawOnTime,
  CAST(100.0*SUM(OnTimeDepartures)/NULLIF(SUM(TotalDepartures),0) AS DECIMAL(6,2)) RawPct,
  SUM(AssessableTotalDepartures)  AssessTotal,
  CAST(100.0*SUM(AssessableOnTimeDepartures)/NULLIF(SUM(AssessableTotalDepartures),0) AS DECIMAL(6,2)) AssessPct,
  SUM(DateExcludedDepartures) WeatherRemoved
FROM dbo.vw_OtpMonthlyRouteStop GROUP BY ServiceMonth ORDER BY ServiceMonth;
```

---

## Step 1 — Clear the ground (us) — **COMPLETE 2026-11-01**

### 1a — ✅ T2.4, the classification filter, proven on live data

**Owner:** Ty. **Done 2026-11-01.** This closes the last open Tier 2 case.

Route **490** was classified `SpecialEvent` temporarily, the official August figure read,
the classification removed, and the figure read again. Both halves of the case are now
evidenced — a classified route leaves the official figure, and an unclassified route is
assessable by default.

| 2026-08, agency | Raw | Assessable | Routes below target |
| --- | --- | --- | --- |
| Before (490 unclassified) | 62,748 / 53,527 = **85.3047%** | 62,748 / 53,527 = **85.3047%** | 9 |
| 490 classified SpecialEvent | 62,748 / 53,527 = 85.3047% | 60,509 / 52,096 = **86.0963%** | 8 |
| After the classification was removed | 62,748 / 53,527 = **85.3047%** | 62,748 / 53,527 = **85.3047%** | 9 |

The subtraction is exactly route 490's own figures — 2,239 departures and 1,431 on time —
and the official figure moved **+0.7916 points** while raw did not move at all, which is
the documented behaviour: classification is a filter on the assessable figure only.

**Proof:** `GET /api/otp-monthly?month=202608`, `measurement.assessable`, with
`measurement.routes[route_id=490].route_category` reading `SpecialEvent` then `FixedRoute`.
**State restored:** `SELECT COUNT(*) FROM dbo.RouteClassification WHERE route_id=490` → 0,
13 classified routes, the set the month opened with.

> **Raised, not fixed — a classification change leaves no history.** `RouteClassificationHistory`
> recorded neither the create nor the delete. The PUT copies the *existing* row into history
> before overwriting it, so a brand-new classification writes nothing, and the DELETE writes
> nothing at all. The act that moved August's official figure by 0.79 points and the act
> that moved it back are both invisible. See "Findings raised" below; this is Q7's evidence.

### 1b — ✅ September's test decisions cleared

**Owner:** Ty. **Done 2026-11-01**, through the application's own reset —
`DELETE /api/otp-stop-exclusions?month=202609`, the call the Review Queue's reset button
makes (PR #409). No rows were deleted in SQL. The endpoint reported `deleted: 361`.

**What was there, captured before it went** (this is the evidence for T4.4 / Q6):

| | |
| --- | --- |
| Decisions | 178 approved, 183 rejected — **361** |
| Reviewer | a single actor, recorded as `system` |
| Entered | 2026-10-15, rejections 15:23:29–15:29:49, approvals 16:58:07–17:01:36 |
| Rate | 2.1 s per rejection, **1.2 s per approval** |
| Coverage | 361 of the month's 860 route/stop/day rows — **42% of September decided** |
| Reason code | `SCHED_RECOVERY` on all 361, approvals and rejections alike |
| Routes touched | 17, from 1 decision (445) to 24 (475) |
| Effect | removed **14,813 of 62,538 departures** and 10,087 on-time, moving the official figure **81.20% → 85.27%, +4.07 points** |

**After the reset:** assessable = raw = 62,538 / 50,781 = **81.20%**, `stop_excluded` zero,
352 Flagged Stops back to pending, 11 routes below target. 2026-07's genuine 3 approved and
3 rejected were left alone and still read 84.86% raw / 84.91% assessable.

**Would anything have flagged it? No — nothing anywhere.**

- **The restatement ledger recorded nothing.** `OtpMonthlyRestatements` holds no row at all
  dated 2026-10-15, and nothing for 202609 between 2026-10-03 and 2026-10-28. It is a feed
  ledger: it compares what Avail published against what was stored. An exclusion is not a
  feed change, so a decision that moves the official figure four points is outside what it
  watches, by design.
- **The audit stream is the rows themselves.** `/api/otp-audit-stream` is built by querying
  `OtpStopExclusions`, not a log table. After the reset, September's stream holds **2
  entries, both `measurement_parameters`** — the 361 decisions and every trace of them left
  with the rows. The reset is logged only as a line of App Insights text from the handler.
- **No actor was ever recorded.** All 361 decisions carry `reviewed_by = 'system'`, as do
  2026-07's genuine six. This is not a choice somebody made: Easy Auth hands the handler no
  `userDetails` for this tenant (`/api/me/access` returns `"email": null`), so
  `userDetails || "system"` always falls to `system`. OnBoard cannot name who decided an
  exclusion, who cleared a month, or who classified a route.
- **No volume or rate control exists.** Nothing caps a bulk approval, flags one, or asks a
  second person to confirm it.

So the answer to Q6 is sharper than the question. The nine genuine decisions across nine
months are not the finding; the finding is that **361 decisions in 98 minutes by an
unnamed actor moved the official figure four points, and the system has no record that it
happened.** Take that to Tier 3 and Tier 4 as it stands.

### 1c — ✅ T1.1 run on 2026-08, the control month; T1.2/T1.3 recorded, external half still open

**Owner:** Ty (OnBoard side) / Rob (Avail export). **Run 2026-11-01.**

**T1.1 — PASS, exactly.** `SELECT SUM(total), SUM(ontime) FROM dbo.OtpMonthlyRouteStopDay
WHERE service_month='202608'` returns **62,748 departures, 53,527 on time, 85.30%** — the
plan's expected figure to the digit, and no sign of the pre-restatement 65,278 / 83.62%.

Supporting integrity checks on the same month, all clean:

| Check | Result |
| --- | --- |
| Rows vs distinct route/stop/day keys | 912 / 912 — no key collision of the kind that cost March 855 departures |
| Measurement parameter stamp | every row `2/5/10/60/0/1/1`, min = max |
| `actual_departures + missed = total` | 912 of 912 rows |
| Routes | 20 |
| Day-of-week spellings present | `Mon`, `Tues`, `Wed`, `Thur`, `Fri`, `Sat`, `Sun` — note `Tues` and `Thur`, which an exclusion must match exactly |
| Restatement since month end | 538 rows, all from the 2026-10-28 corrective re-pull (58 days after month end), none since |

**T1.2 — OnBoard's side recorded; it cannot pass until Avail's August export arrives.** The
20 routes below are what OnBoard holds. Rob's export is still the other half: comparing
OnBoard to a figure derived from OnBoard proves nothing.

| Route | Departures | On time | % | | Route | Departures | On time | % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 420 | 1,880 | 1,661 | 88.35 | | 470 | 1,174 | 1,004 | 85.52 |
| 425 | 3,645 | 3,117 | 85.51 | | 475 | 2,337 | 1,672 | 71.54 |
| 436 | 4,256 | 3,933 | 92.41 | | 477 | 2,526 | 1,837 | 72.72 |
| 440 | 2,865 | 2,274 | 79.37 | | 480 | 746 | 611 | 81.90 |
| 442 | 2,228 | 2,082 | 93.45 | | 490 | 2,239 | 1,431 | 63.91 |
| 444 | 8,584 | 6,779 | 78.97 | | 493 | 84 | 59 | 70.24 |
| 445 | 4,292 | 4,082 | 95.11 | | 495 | 11,027 | 9,654 | 87.55 |
| 446 | 3,839 | 3,650 | 95.08 | | 497 | 2,759 | 2,595 | 94.06 |
| 447 | 1,801 | 1,642 | 91.17 | | 499 | 1,880 | 1,818 | 96.70 |
| 460 | 1,650 | 1,375 | 83.33 | | 465 | 2,936 | 2,251 | 76.67 |

**T1.3 — stop/day grain recorded for route 490.** 60 rows: 12 stops × 5 weekdays, no
Saturday or Sunday service. Reproduce with:

```sql
SELECT stop_id, stop_name, day_of_week, total, ontime, early, late, missed, actual_departures
FROM dbo.OtpMonthlyRouteStopDay
WHERE service_month='202608' AND route_id=490 ORDER BY stop_id, day_of_week;
```

**How to read a difference when the export arrives.** A gap is not rounding. Different
totals mean the poll caught the month at a different moment than the export — re-pull
08/2026 and compare again. A route in one and not the other is a classification or
ID-mapping question, not a counting question. The method itself is already proven: Avail's
own BI pull for September agreed with OnBoard to 0.10 points across every route.

### 1d — ✅ This checklist

**Owner:** Ty. **Done 2026-11-01.**

### 1e — ⬜ Send the Avail reply

**Owner:** Ty. Drafted in `avail-reply-2026-10-29.md`; carries Q13 (a stable stop-record
identifier) and Q14 (the `09-01-2026` date format). **Done looks like:** sent. Nothing on
this list waits on the answer.

---

## Step 2 — THE GATE (Rob) — ⬜ not started

Nothing below step 2 means anything until these are answered, and **Q3 is asked first**: a
wrong answer makes A0 pointless.

| | Item | Owner | What proves it | Done looks like |
| --- | --- | --- | --- | --- |
| ⬜ | **Q3 / T4.3 — departures or arrivals?** Does the contract, and does existing reporting, measure what OnBoard measures? The manual notes record a 36-point divergence on one route in one week. | Rob | One conversation, plus the contract clause | A written answer. If it is arrivals, **stop** — Tier A is not a reconciliation of two methods, it is a comparison of two metrics, and this checklist is reopened from here. |
| ⬜ | **A0 — do the two manual artifacts agree with each other?** Produce the weekly CSV sum and the canned monthly Avail report for 2026-05, 2026-06 and 2026-08, and compare them **to each other**, not to OnBoard. | Rob | The two artifacts, side by side, per month | A named authoritative figure for each of the three months **and the stated reason for the choice**. If they disagree, record both figures and which one wins — that decision is worth writing down whatever happens to OnBoard. |

> **Account for the week boundary rather than letting it masquerade as a discrepancy.** The
> week containing 1 June also contains the end of May, so a weekly sum cannot align to a
> calendar month. Split the boundary weeks or quantify the effect before calling a gap a gap.

---

## Step 3 — Restate the acceptance standard (Ty + Rob) — ⬜ not started

| | Item | Owner | What proves it | Done looks like |
| --- | --- | --- | --- | --- |
| ⬜ | **Q2 — does the standard still stand?** It was "every month within 0.5 points, and no month tiering differently". The 2026-10-28 correction moved every month up 1.6–2.4 points and **June and August both crossed Warning → Meets at the 85 boundary** for a known and accepted reason. | Ty + Rob | The restated-figures table in the validation plan | A written standard, specifically saying what a tier change means now. Thirty minutes. **After** step 2 produces real manual figures and **before** step 4 compares anything. |

---

## Step 4 — The comparison, A1–A4 (Rob) — ⬜ blocked on steps 2 and 3

| | Item | Owner | What proves it | Done looks like |
| --- | --- | --- | --- | --- |
| ⬜ | Compare OnBoard against the authoritative manual figure for 2026-05, 2026-06, 2026-08 | Rob | Route Summary's assessable figure is OnBoard's official number. **Record the raw figure beside it.** | The Tier A table filled in |
| ⬜ | Explain every gap above 0.1 points against A3's list | Rob | — | A written reason per gap |
| ⬜ | State the direction of the differences | Rob | — | A consistent bias is a defect, and will be worse in the months nobody checked. Scatter inside tolerance is what a pass looks like. |

> If raw agrees with the manual figure and assessable does not, **the entire difference is
> in the exclusions** — which makes it a conversation about process, not about data. With
> September cleared, only 2026-07 carries any exclusion at all, worth 0.05 points, so a
> large assessable-only gap in the three decision months would be surprising and worth
> chasing before anything else.

---

## Step 5 — Tier 3 with OCC (Rob + OCC, one sitting, ~1 hour) — ⬜ not started

T3.1–T3.9: the controls around the number — who may change it, whether the change is
recorded, whether a closed month can move.

| | Item | Owner | Note |
| --- | --- | --- | --- |
| ⬜ | Run T3.1–T3.9 | Rob + OCC | **Take item 1b's findings into this session.** They are not hypothetical any more: 361 decisions, no named actor, no record, no rate limit. T3's question "is the change recorded?" already has an answer. |
| ⬜ | **T3.9 / Q10 — must a closed month stay closed?** On a finalized month, Monthly Assessments shows the figure the contractor was shown while Route Summary shows today's live figure. | Rob | The divergence is deliberate — it is what stops a closed assessment moving under the contractor's feet — but Rob has to agree it is right |
| ⬜ | Set the flagging threshold back to 0.15 afterwards | Rob | Administration → OTP Compliance → Threshold Tuner |

---

## Step 6 — Record the Tier 4 decisions (Rob + Ty) — ⬜ not started

Not pass/fail. Write the answers into the validation plan's Tier 4 section, not into an
email.

| | Item | Owner | Note |
| --- | --- | --- | --- |
| ⬜ | **Q5 / T4.1 — weather days.** How is a snow day handled today, who approves one, does the contractor see the adjustment before the month is assessed? | Rob | Two limits to state: a date before 2026-09-14 cannot be evidenced from the daily feed, and holidays are deliberately not excluded |
| ⬜ | **Q6 / T4.4 — exclusion volume.** | Rob + Ty | **Evidence is in item 1b and it is stronger than the question assumed.** Answer the control question, not just the volume one |
| ⬜ | **Q7 / T4.5 — who classifies new Avail RouteIDs before a month closes?** An unclassified route counts as fixed route by default, so a new special-event route silently enters the official figure. | Rob | **Item 1a measured what one classification is worth: 0.79 points on August, with no history written.** Finding 2 below belongs in this answer |
| ⬜ | **Q8 / T4.6 — are the twelve reason codes the vocabulary OCC and the contractor actually use?** | Rob | September's 361 test decisions used one code for everything, so they say nothing about this |
| ⬜ | **Q9 / T4.2 — should OnBoard own contractor notification?** The Weather page shows "notified / acknowledged" and OnBoard sends nothing and sets nothing. | Rob | |
| ⬜ | **Q4 / T4.7 — are `2/5/10/60` contractual, or Avail's BI default?** Who at MVTA owns a change? | Rob | The register (migration 151) records what we believe, not what the contract says. Changing any one value restates every figure the feed has ever stored |

---

## Step 7 — Sign off, A5 (Rob) — ⬜ not started

| | Item | Owner | Done looks like |
| --- | --- | --- | --- |
| ⬜ | Approve OnBoard as the system of record, approve with named conditions, or do not approve and say what would have to change | Rob | The sign-off table in `otp-compliance-validation-plan-2026-09-22.md` filled in. **Conditions go in that table, not in an email.** |

---

## Findings raised by step 1, not fixed

These were found by running 1a–1c. None is a Tier 1 or Tier 2 failure — both cases passed —
so none was patched. They are control and audit findings, and they belong in step 5 and
step 6 rather than in a hurried PR.

**Finding 1 — OnBoard records no actor on any compliance decision.** Easy Auth supplies no
`userDetails` for this tenant, so `authResult.principal.userDetails || "system"` always
resolves to `system`. Every stop exclusion, every route classification and every month
reset is attributed to `system`. The grant is real — `/api/me/access` returns the signed-in
person's roles correctly — but the identity never reaches the row. *Affects
`otpStopExclusions.ts`, `routeClassification.ts`, and anything else using that fallback.*

**Finding 2 — a route classification leaves no history.** `RouteClassificationHistory`
recorded neither the creation nor the removal of route 490's temporary classification. The
PUT copies the existing row into history *before* overwriting it, so a brand-new
classification writes nothing; the DELETE writes nothing at all. A classification is worth
0.79 points on August by measurement, and it is untraceable.

**Finding 3 — the exclusion audit stream is the exclusion rows.** `/api/otp-audit-stream`
queries `OtpStopExclusions` rather than a log, so a month reset erases the decisions and
their audit trail in one call. The reset itself survives only as an App Insights log line.

**Finding 4 — the console cannot renew a token.** The console's Content-Security-Policy
sets `frame-src https://login.microsoftonline.com` without `'self'`. MSAL's silent renewal
navigates a hidden iframe to Entra and Entra redirects it **back to the console's own
origin** carrying the code — which the policy blocks, so `acquireTokenSilent` can never
complete and the console hangs on "Checking your access…". Reproduced on the deployed dev
console 2026-11-01; the header is served by the host, so it is not browser-specific. The
fix is one token — adding `'self'` to `frame-src` — but it is a security header and wants
its own change. *Items 1a and 1b were run against the same API endpoints the console's own
buttons call, with the console's own session token, because of this.*

**Finding 5 — not a defect, worth knowing: outliers are small.** 2026-08 holds 48
departures that are counted in the denominator but fall in no early/on-time/late bucket —
Avail's outliers, which `include_outliers = 1` keeps. Dropping them would move August from
85.30% to 85.37%, and the largest month (2026-02) by 0.24 points. So **`include_outliers`
is not the explanation for route 465's old 4,271-against-4,045 departure gap** — that was
5.3%, two orders of magnitude larger, and it was resolved by Avail's month-boundary fix.
The note in migration 151's register can be closed on that basis.

---

## Carried forward, acted on by nobody

- **Q11 — did any pre-correction 2026 figure go out externally?** To the contractor, a board
  packet, a report. Every month now reads 1.6–2.4 points better. A communication, not a
  defect. *Ty.*
- **Q12 — the eleven rows Avail no longer reports** (2026-05 holds 999 against a re-pull's
  991, 2026-08 912 against 910, 2026-09 860 against 859). The MERGE never deletes, so a
  route/stop/day Avail has dropped keeps its last figure forever, which inflates slightly.
  Whether OnBoard may delete a figure because a feed stopped mentioning it is a decision.
  *Ty.* PR #456 proposes a migration for this and is open, not merged.
- **Holiday / reduced-service skew**, built and passing on
  `claude/otp-reduced-service-declared`, and **PR #391**. Both deliberately held until Tier
  A returns — a second subtraction mid-validation would invalidate the comparison. **Do not
  revive either from this checklist.**
