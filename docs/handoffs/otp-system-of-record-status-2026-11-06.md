# OTP as the system of record — status check, 2026-11-06

**What this is.** An audit of where the fixed-route OTP baseline actually stands, run
against dev and against `main` rather than against what the handoff documents claim.
Everything below was re-verified on **2026-11-06** unless it says otherwise. Where a
document and the database disagree, the database is quoted and the document is named.

**Companions.** `otp-system-of-record-closeout-2026-10-31.md` (steps and owners),
`otp-baseline-checklist-2026-11-01.md` (running order and evidence),
`otp-compliance-validation-plan-2026-09-22.md` (test cases),
`otp-questions-for-rob-2026-11-01.md` (the ten questions, revised 2026-11-05),
`avail-reply-2026-10-29.md` (the draft to Charlie Flynn).

**This document reports. It fixes nothing.** Five document corrections and one
documentation gap are named below and left for a decision.

---

## The verdict

**OnBoard cannot be baselined as the system of record today, and the belief that only
Rob's answers remain is close but not exact.** Four things that are not answers are also
outstanding, and two of them are MVTA's rather than Rob's:

1. **Nobody can reach the pages two of Rob's questions point at.**
   `service-configuration.edit` is carried by **no app-owned role** — only System
   Administrator, by holding all actions, and that role has **one live grant**. Verified
   today in `AccessRoleActions` / `AccessRoleGrants`. Administration → OTP Compliance (the
   per-month Re-pull buttons, the measurement-parameter register, the Threshold Tuner) is
   therefore unreachable by Rob, which blocks his questions 4 and 5 and step 5's closing
   item. This is a grant or a role change, not an answer.
2. **Tier 1 cannot be signed on OnBoard's evidence alone.** T1.2 and T1.3 hold OnBoard's
   half only; Avail's August export is the other half and has not arrived.
3. **Tier 3 will fail two of its own cases when it is run,** on gaps already proven and
   re-verified today (below). Running the sitting without deciding what to do about them
   produces failures nobody learns anything from.
4. **The contract question is recorded as both answered and unanswered,** in two documents
   five days apart. See "What is genuinely blocking".

What is *not* blocking: anything to do with Avail's data fidelity, any build, any
migration, and both of the build items that fell out of Ty's answers.

---

## The two disputed figures, settled

### August's total departures: **62,746**. 62,748 is stale.

Read from dev today:

| 2026-08, agency | Value |
| --- | --- |
| Rows / distinct route·stop·day keys | **910 / 910** (no collision) |
| Total departures | **62,746** |
| On time | **53,525** |
| Raw % | **85.3042%** |
| `actual_departures + missed = total` | 910 of 910 rows |
| Measurement stamp | `2/5/10/60/0/1/1`, min = max |
| Day-of-week spellings | `Mon` `Tues` `Wed` `Thur` `Fri` `Sat` `Sun` |

62,748 was correct up to **2026-11-02**, when migration 152 retired two keys Avail had
stopped returning (one row each on routes 477 and 480). It is a historical reading, not a
disagreement. **Quote 62,746 to Rob.** The validation plan's T1.1 and its migration-152
table both already name 62,746, and so does Rob's handoff; the only place 62,748 still
stands unqualified is the 2026-10-31 closeout's own narrative of item 1c, which records the
correction in the same paragraph. Nothing needs re-sending.

### The March stop rename: **Monday 16 March 2026**. "About 18 March" is wrong.

The arithmetic checks out independently. March 2026 opens on a Sunday, so it holds five
Sundays, five Mondays and five Tuesdays and four of every other weekday. A boundary at
Monday 16 March divides occurrences Mon 2/3, Tue 2/3, Wed–Fri 2/2, Sun 3/2 — which is
exactly the shape of the recorded pairs (28/41 Mon, 28/42 Tue, 28/28 Wed–Fri, and 39/24 on
route 442's Sundays). A boundary at 18 March reverses Monday and Tuesday to 3/2 and
contradicts them. **16 March is right and 18 March is excluded, on the weekday arithmetic
alone.**

One limit worth stating, because the reply goes to a vendor: the 27 duplicate pairs are
**no longer re-derivable from dev**. March now stores 1,081 rows over 1,081 distinct keys —
the loader sums the pair — so the per-record counts in the Avail reply are read from the
App Insights collision log of the 2026-10-31 re-pull, not from the database. The arithmetic
above is what can be re-checked from dev, and it is consistent. Nothing in the repo still
asserts 18 March except as a correction; `otpMonthlyFeed.ts` was corrected in 1.7.49
(#508). **Send 16 March.**

> **Housekeeping, not a figure.** PR #464 ("Say what actually splits an OTP month in two")
> is still **open and conflicting**, last touched 2026-11-01, and #508 appears to have
> landed the same correction. Check whether #464 carried anything #508 did not — it also
> touches `otpHistoricalBackfill.ts` and the feed tests — before closing it.

---

## 1. Tier by tier

| Case | State | Owner of what remains |
| --- | --- | --- |
| **A0** — the two manual artifacts agree with each other | **Not started.** Still the gate | Rob |
| **A1–A4** — the comparison | **Not run**, blocked on A0 and the restated standard | Rob |
| **A5** — the recommendation | **Not run** | Rob |
| **Tier 1** — source fidelity | **Passed on OnBoard's side; not complete.** T1.1 passes; T1.2/T1.3 hold one half of a two-sided test; T1.5 not run | Rob (Avail's August export), Ty (T1.5) |
| **Tier 2** — rule correctness | **Passed in full**, T2.4 included | — |
| **Tier 3** — workflow controls | **Not run**, and two cases are already known to fail | Rob + OCC to run; Ty to decide on the gaps |
| **Tier 4** — process fit | **Open.** Ten questions, none answered | Rob |

### A0 — not started, and the two live documents disagree about what it *is*

The closeout (2026-11-02) records Ty answering that there is only one manual source — the
canned monthly report, with the CSV a download from it — and concludes that **A0 collapses
from a reconciliation of two methods into an arithmetic check** that weekly rows sum to the
monthly figure. The questions document **revised three days later (2026-11-05)** still puts
A0 to Rob as "two manual artifacts … they have never been compared to each other", and asks
for a figure from **both** methods.

Both cannot be true, and the one going to Rob is the later document. Either Ty's answer
stands and question 2 should be rewritten to the arithmetic form before it is sent, or the
answer was about how the CSV is produced rather than about whether two independent artifacts
exist. **Settle this before the conversation**, because it changes what Rob is being asked
to produce for three months.

### Tier 1 — passing, and corroborated by Avail, but formally half-done

**T1.1 — PASS**, re-verified today; the table above is the evidence.

**Independent corroboration still holds.** Avail's own BI pull for September, re-read from
dev today:

| Route | OnBoard (dev, today) | Avail BI | Gap |
| --- | --- | --- | --- |
| 420 | 89.17 (1,838 / 1,639) | 89.2 | 0.03 |
| 465 | 66.33 (**4,045** / 2,683) | 66.4 | 0.07 |
| 475 | 56.79 (2,673 / 1,518) | 56.9 | 0.11 |
| 495 | 80.81 (9,250 / 7,475) | 80.9 | 0.09 |
| **Agency** | **81.20** | **81.3** | **0.10** |

Route 465 returns the BI report's exact 4,045.

**T1.2 / T1.3 — recorded, not passed.** Both compare OnBoard against OnBoard until Avail's
August export arrives. Calling Tier 1 "passed" is fair about the method and not yet true of
the case.

**T1.4 — reads clean, and the feed is demonstrably live.** `OtpMonthlyRestatements` holds
**zero rows detected since 2026-11-02**; the latest rows anywhere are 2026-03 on 2026-10-31
(81) and 2026-10 on 2026-11-01 (206), all from our own corrective re-pulls. The ledger's
silence means something because the feed is still running: 2026-11 was last updated
**2026-11-06 03:00 UTC**. The plan's "empty after a few weeks is the answer" standard is
being met for everything after the corrections.

**T1.5 — not run.** No backfill-versus-poll comparison is recorded anywhere.

### Tier 2 — passed in full, and the T2.4 evidence is intact

T2.1, T2.2, T2.3, T2.5 and T2.6 passed 2026-09-22. T2.4 passed on live data 2026-11-01, and
its state is confirmed restored today: **13 classified routes, route 490 absent**, route
490's own 60 rows still reading 2,239 departures / 1,431 on time. Re-running the case gives
the same +0.79-point move against a baseline that now reads 62,746 / 53,525.

### Tier 3 — not run, and two cases will fail

All of T3.1–T3.9 are outstanding. Three control gaps found while clearing the ground are
**still unfixed in `main`**, verified in code and data today:

- **No actor is recorded on any compliance decision.** `authResult.principal.userDetails ||
  "system"` is still the fallback in `otpStopExclusions.ts`, `otpDateExclusions.ts` and
  `routeClassification.ts`. All six surviving stop-exclusion decisions carry
  `reviewed_by = 'system'`. **T3.4 (reviewer identity and time) fails as written.**
- **A route classification writes no history.** The PUT copies the *existing* row into
  `RouteClassificationHistory` before overwriting, so a new classification writes nothing,
  and the DELETE handler writes nothing at all — it is a bare `DELETE FROM
  RouteClassification`. `RouteClassificationHistory` holds **0 rows for route 490**, either
  side of the act that moved August's official figure by 0.79 points.
- **The exclusion audit stream is the exclusion rows.** A month reset removes the decisions
  and their trail together. **T3.7 (audit stream completeness) cannot pass** for a month
  that has been reset.

**A fourth gap, not previously recorded: weather approval is not restricted to anyone.** A
date exclusion is created, approved and withdrawn under `compliance-review.review`, which
is carried by **both** Compliance Analyst and Compliance Manager — **12 live grants across
the two roles, held by 7 distinct people**, five of them analysts. Ty's answer to Q5 is that
*the OCC manager* approves a weather day. The system does not enforce that, and never has.
Worth stating in Q5's answer as a condition, or splitting the action.

### Tier 4 — open

Ten questions, none answered. The document is written, merged (#466) and sendable.

---

## 2. Step by step, against the closeout's seven steps

**Step 1 is not complete, and its own documents say so in their detail while the summary
says otherwise.** What is complete is everything step 1 could finish without Rob or Avail.

| | Item | State |
| --- | --- | --- |
| **1a** | T2.4, the classification filter, on live data | **✅ Done 2026-11-01**, and verified intact today: 13 classified routes, 490 unclassified, its 60 rows unchanged |
| **1b** | Clear September's test exclusion decisions | **✅ Done 2026-11-01.** Verified today: 2026-09 reads **62,521 / 50,764 / 81.20% raw and assessable**, `OtpStopExclusions` holds **nothing for 202609**. The only decisions left anywhere are 2026-07's six |
| **1c** | Run T1.1–T1.3 formally on 2026-08 | **◻ Partly.** T1.1 passes (verified today). T1.2 and T1.3 record OnBoard's side and **wait on Avail's August export** |
| **1d** | Send the Avail reply | **⬜ Not done.** The draft still reads "**Not sent. Tyre sends it.**" at the top, and nothing in the repo records it going out. Only Ty can confirm; from here it is unsent |

> **A numbering trap.** The closeout calls the Avail reply **1d**. The checklist calls
> *itself* 1d and the Avail reply **1e**. Same item, two names — and the checklist's 1d is
> ticked, which is how "step 1 done except 1d" can read as if the reply had gone.

| Step | State |
| --- | --- |
| **2 — Q3 then A0 (the gate)** | **Not started.** And see A0 above: the two documents disagree on what A0 asks for |
| **3 — Restate the acceptance standard** | **Not started.** Blocked on step 2 by design |
| **4 — The comparison, A1–A4** | **Not started.** Blocked on steps 2 and 3 |
| **5 — Tier 3 with OCC** | **Not started.** Two cases will fail on known gaps; the closing item (reset the Threshold Tuner to 0.15) needs `service-configuration.edit`, which Rob does not have |
| **6 — Record the Tier 4 decisions** | **Not started** |
| **7 — Sign off (A5)** | **Not started.** The plan's sign-off table and the system-of-record decision block are both empty |

---

## 3. What is genuinely blocking — the belief, tested

**"Only Rob's answers remain" is mostly right and materially incomplete.** Rob genuinely
owns the gate, the comparison, the Tier 4 decisions and the sign-off. But:

**The contract question is recorded as both answered and unanswered.** The closeout's
answer table (2026-11-02) has "departures or arrivals" answered **Departures**, with the
effect "Tier A is a valid comparison. Gate cleared." The questions document, revised
2026-11-05, asks it as **question 1** and asks for "a clause or section reference from the
contract". No clause reference exists in any document. Ty's answer is a statement about what
OnBoard measures and what the circulated reporting carries; **T4.3 asks what the contract
says**, and that is not on the record. The gate is not cleared. If the contract is silent,
that is a decision to record — but it has to be recorded.

**A second numbering trap, and it matters.** The closeout's answer table renumbers the first
three questions relative to its own question list: answers Q1 = list Q3 (departures),
answers Q2 = list Q1 (manual artifact), answers Q3 = list Q2 (acceptance standard). Anyone
filing Ty's answers against the question list will file three of them against the wrong
questions.

**Not Rob, and not an answer:**

- **The `service-configuration.edit` grant.** Verified today: no app-owned role carries it;
  System Administrator reaches it only by holding all actions, with one live grant. Rob's
  questions 4 and 5 both point at a page he cannot open. Add the action to Compliance
  Manager, or plan for Ty to drive those pages in the session. Decide before the meeting.
- **The Tier 3 control gaps.** Four of them now (the three recorded plus unrestricted
  weather approval). They are cheap to name as sign-off conditions and not cheap to fix;
  either way the decision is MVTA's, and it should be made before the OCC sitting rather
  than discovered in it.
- **Avail's August export.** Tier 1's second half. Rob asks for it, but it is Avail's to
  produce, so it can be requested today and in parallel with everything else.

**Not blocking, confirmed:** no OTP-functional change has merged since migration 152
(#456). Everything OTP that landed after it is a missed-trip or comment change (#499, #504,
#506, #508). Dev's OTP state is the state these documents describe. The holiday-skew branch
and PR #391 are untouched and still held.

---

## 4. The three questions Ty had not answered as of 2026-11-02

**None has been answered.** All three survive, and two have changed shape.

**(a) A month inside 0.5 points but across a tier boundary — pass or fail?** Still open, now
posed precisely. Rob's question 3 carries the arithmetic: 2026-08 sits **0.30 above the 85
boundary**, so a manual figure anywhere in **84.8–85.8** is simultaneously inside the
0.5-point tolerance and a tier change. The validation plan's A2 still says flatly that a
month tiering differently **fails Tier A regardless of the point gap** — which, on today's
figures, makes a 0.1-point disagreement on August a Tier A failure. That is the clause that
has to be restated, and it is step 3's whole content. Owner: Ty + Rob.

**(b) Is the exclusion queue under-reviewed?** Unanswered by MVTA, but the data half is
settled and the question is sharper than when it was asked. Dev holds **six stop-exclusion
decisions for the whole of 2026** — all 2026-07, three approved and three rejected, all
entered within twenty minutes on 2026-08-06, all `reviewed_by = 'system'` — and **zero date
exclusions have ever been created**. The three approvals move July by 0.05 points
(84.86 → 84.91), which is the only exclusion anywhere in the year. Paired with the October
episode (361 decisions in 98 minutes, four points, nothing flagged), the control question
stands on its own regardless of what Rob says about volume. Owner: Rob + Ty.

**(c) The OCC manager's name.** Still unknown, still blank in every document, and both role
grants Ty wanted checked still turn on it. The grant *shape* is now known and does not need
the name: route classification needs `service-configuration.edit`, which nobody but a System
Administrator holds, and weather approval needs `compliance-review.review`, which 7 people
hold. So whatever the name turns out to be, **one of the two roles is too narrow and the
other is too wide.** Owner: Ty.

---

## 5. The two build items — neither has been built

**Weather days in the Performance Assessment report — not built.** `functions-restapi/src/lib/report/`
(`buildReportModel.ts`, `renderAssessmentReport.ts` and the rest of the directory) contains
**no occurrence** of weather, date exclusion, excluded dates or snow. The last commit to
touch that directory is #263 on 2026-09-09, about road calls. No open PR builds it. Ty's
answer to Q9 — that weather days should surface from the OTP module **and** the Performance
Assessment — is therefore still half unmet, exactly as the closeout said, and nothing has
moved in four days.

**Reopening a finalized period — now answered by reading the code, and the closeout cites
the wrong file.** `lib/performanceAssessmentWorkflow.ts`, the file the closeout names, is an
in-memory model **referenced only by its own test**; it is not the running product. The real
path is `POST /assessment-periods/{id}/reopen` in `functions/assessmentPeriods.ts`.

What it does, on a **finalized** period: sets `status='reopened'`, nulls `final_total`,
`finalized_by` and `finalized_at`, increments `input_revision`, voids the live issuance
proof, writes a `reopened` audit row, and marks every later month of that agreement
**stale**. It does **not** recompute — `PeriodKpiAssessments` keeps the figures from the last
compute.

But it cannot be left there. Review (`PATCH /period-assessments/{id}`) and finalize both
require `computed_revision = input_revision`, and the reopen has just broken that equality,
so both return 409 until `POST /assessment-periods/{id}/compute` runs. That recompute
re-reads the OTP figure **live**, through `resolveOtpFixedRoute` → `measureOtpMonth` — the
same measurement the console and `vw_OtpMonthlyRouteStop` read — and then sets
`computed_revision = input_revision`.

So the answer for Q10 is: **reopening unlocks the period and forces a recompute before it
can move again; it does not itself recompute.** Reopening an **issued** period behaves
differently — it creates a new correction period with the standards and tiers copied and no
KPI rows at all, so that one must be computed from scratch. **Nothing to build.** One small
gap worth naming: between the reopen and the compute, the period still displays the old
figure, and only its status says why.

---

## 6. The governance finding — recorded, but not in the sentence Rob needs

**Confirmed in dev today.** `OtpMeasurementParameters` holds two rows. The live one is
effective **2026-10-27**, segments **`2/5/10/60/0/1/1`**, `declared_by` `migration-151`,
and its `source` reads exactly:

> `Avail confirmation 2026-10-27`

So MVTA's OTP measurement standard has no contractual anchor. Its only provenance is a
vendor's confirmation of that vendor's own BI configuration.

**Is it stated where Rob will see it?** Partly. Question 4 of the merged handoff asks
whether the values are contractual, who owns a change, and how a change would be noticed,
and it says plainly that the register "records what we believe, not what the contract says"
and that changing one value "restates every figure the feed has ever stored". That is the
ownership half.

**The consequence half is not in Rob's document.** It is in the closeout, which Rob is not
being sent. The missing sentence is that because the register's source *is* Avail's
confirmation of Avail's BI defaults, **a change made inside Avail — by Avail, without
telling MVTA — changes MVTA's reported OTP, and nothing in the contract contradicts them.**
That is the governance gap, and it is the reason question 4 is not merely administrative.

**Recommended, not done** (this document changes nothing): add one sentence to question 4 of
`otp-questions-for-rob-2026-11-01.md`, under "Context". Suggested wording —

> Because the register's source is Avail's confirmation of Avail's own BI configuration,
> whoever changes those BI defaults changes MVTA's reported OTP, whether or not MVTA is
> told. Nothing in the contract prevents it, and nothing in OnBoard would notice.

---

## Document corrections to make, and which source to trust

**Trust dev in every case below.**

| # | Where | Says | Dev says |
| --- | --- | --- | --- |
| 1 | Plan, A1 comparison table | 2026-05 = **87.56%** | **87.57%** (67,465 / 59,082). The plan's own migration-152 table already records 87.574 — only A1 is stale |
| 2 | Plan, T4.4 | "**9** decisions across 9 months" | **6**, all 2026-07. A3 in the same plan already says 6 |
| 3 | Closeout, figures table | 2026-10 = 63,443 (accruing) | **67,023**. October finished accruing on 2026-11-01 |
| 4 | Closeout, answer table | Q1/Q2/Q3 | Renumbered against its own question list (= list Q3/Q1/Q2). Three of Ty's answers will be filed against the wrong questions |
| 5 | Closeout, step 1 heading | "DONE 2026-11-01, except 1d" | 1c is also outstanding (T1.2/T1.3), and "1d" means the checklist in one document and the Avail reply in the other |
| 6 | Closeout, Q10 | `performanceAssessmentWorkflow.ts` has the `reopened` state | True but inert — that file is test-only. The live behaviour is in `functions/assessmentPeriods.ts`; see section 5 |

**No Tier 1 or Tier 2 failure was found.** Nothing in this list changes a figure anyone has
quoted externally; items 1 and 3 are hundredths and a month that kept filling.

---

## The one-line framing, updated

Avail's own reporting agrees with OnBoard to a tenth of a point, and every rule case passes.
What stops the baseline is three things that are not about data: a manual process that has
never been compared with itself, a contract that has not been read for what it measures, and
a set of controls around the number — who may change it, and whether anyone would know — that
OnBoard does not yet enforce and cannot yet evidence.

---

*Verified 2026-11-06 against `sqldb-mvta-onboard-dev` — `dbo.OtpMonthlyRouteStopDay`,
`dbo.vw_OtpMonthlyRouteStop`, `dbo.OtpStopExclusions`, `dbo.OtpDateExclusions`,
`dbo.OtpMonthlyRestatements`, `dbo.OtpMeasurementParameters`, `dbo.RouteClassification`,
`dbo.RouteClassificationHistory`, `dbo.AccessRoles`, `dbo.AccessRoleActions`,
`dbo.AccessRoleGrants` — and against `main` at `f1db6c2c`. No row was written and no
document was changed.*
