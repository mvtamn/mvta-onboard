# OTP as the system of record — ten questions for Rob

**Date:** 2026-11-01. **For:** Rob Cooper. **From:** Ty.
**Purpose:** everything still outstanding before MVTA can decide whether OnBoard replaces
the manual process as the official system of record for fixed-route OTP.

You can read and answer this without opening the validation plan. Where a question maps to
a case in that plan the case number is given, so an answer can be filed against it later.

**The framing.** The validation plan was written expecting OnBoard to be the uncertain
party. It isn't any more. Avail's own reporting agrees with OnBoard to a tenth of a point.
The open question is now whether the manual process agrees with itself — and that is a
question about the manual process, which is why almost all of what is left needs you
rather than a build.

---

## Where it stands

**Every 2026 month is now measured on MVTA's own parameters** (`2/5/10/60`, outliers
included, missed counted). Raw agency OTP, verified against dev on 2026-11-01:

| Month | Raw % | Departures | | Month | Raw % | Departures |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-01 | 90.63 | 61,203 | | 2026-06 | **85.92** | 65,284 |
| 2026-02 | 90.96 | 58,328 | | 2026-07 | 84.86 | 64,411 |
| 2026-03 | 90.50 | 67,330 | | 2026-08 | **85.30** | 62,748 |
| 2026-04 | 89.13 | 68,582 | | 2026-09 | 81.20 | 62,538 |
| 2026-05 | **87.56** | 67,532 | | 2026-10 | 83.93 | 65,956 (accruing) |

**Bold are the three decision months** — the ones the comparison will be run on.

*(2026-10 read 83.78% on 63,443 departures in the 2026-10-31 closeout. It has accrued since;
the figure above is dev as of today. No other month moved.)*

**Tier 1 — does OnBoard hold what Avail published? Effectively discharged, and Avail
discharged it themselves.** Charlie Flynn at Avail ran *On-time Departure Performance by
Route* from Avail BI for September 2026. Against OnBoard:

| Route | OnBoard | Avail BI | Gap |
| --- | --- | --- | --- |
| 420 | 89.17 | 89.2 | 0.03 |
| 465 | 66.33 | 66.4 | 0.07 |
| 475 | 56.79 | 56.9 | 0.11 |
| 495 | 80.81 | 80.9 | 0.09 |
| **Agency** | **81.20** | **81.3** | **0.10** |

Route 465 returns **4,045 departures — the BI report's exact count.**

**Tier 2 — rule correctness:** passed 2026-09-22, apart from one case (the fixed-route
filter, which has never had a live route to remove). Ours to close, not yours.

**Tier 3 — the controls around the number:** not run. One sitting with OCC, and question 10
below is the part of it that needs your agreement rather than a test.

**One figure deliberately not quoted here.** September's *assessable* figure is not usable.
It rests on 178 approved and 183 rejected stop exclusions entered by a single reviewer
between 15:23 and 17:01 on 2026-10-15, removing 14,813 of 62,538 departures. That is test
data, it will be cleared, and it is itself the evidence for question 6.

---

## Prerequisites — console access

Rob's grants on dev, checked 2026-11-01:

1. **`compliance-review.view` — granted.** Via Compliance Analyst and Compliance Manager.
2. **`compliance-review.review` — granted.** Via the same two roles. Rob can approve and
   reject in the Review Queue.
3. **`service-configuration.edit` — NOT granted, and no app-owned role currently carries
   it.** Only System Administrator reaches it, by holding all actions. This is the action
   that gates Administration → OTP Compliance, which is where the per-month **Re-pull**
   buttons and the measurement-parameter register live. Ty must either add the action to
   Compliance Manager or run those pages on Rob's behalf. **Decide which before the
   session**, because questions 4 and 5 both point at that page.

---

## The questions

The first two can invalidate everything else. Question 3 decides what a pass even means.
Nothing below question 4 is worth discussing until those three are settled.

### 1. Does the contract measure departures or arrivals? *(T4.3)*

**The question:** does the contract — and does the reporting MVTA circulates today —
measure departure OTP or arrival OTP?

**Context.** OnBoard measures **departures**, because that is what Avail's monthly report
carries. The manual's own notes record a week in which departure and arrival OTP differed
by up to **36 points on a single route**. So this is not a definitional nicety.

**Why it changes what happens next.** If the manual process measures arrivals, then the
whole comparison is not two methods disagreeing — it is two different metrics, and every
gap it produces is meaningless. Ask this before anything else, because a wrong answer makes
question 2 pointless work.

**A usable answer:** "departures", with a clause or section reference from the contract. If
the contract is silent, say so — that is also an answer, and it becomes a decision to
record rather than a fact to look up.

### 2. Which manual artifact is the baseline? *(A0)*

**The question:** of the two manual artifacts that exist, which one is authoritative, and
why?

**Context.** There are two: a **weekly CSV from Avail summed in a spreadsheet**, and a
**canned Avail report run monthly**. They have never been compared to each other. Until one
is named, there is nothing for OnBoard to be validated against.

**The week-boundary problem, stated before anyone calls it a discrepancy.** The week
containing 1 June also contains the end of May. A weekly sum therefore *cannot* align to a
calendar month. That is a property of the method, not an error in it and not a fault in
either artifact — it needs quantifying or splitting at the boundary, not explaining away.

**Why it changes what happens next.** If the two artifacts disagree with each other, the
finding is about the manual process, and the right next step is deciding which is
authoritative — a decision worth recording whatever happens to OnBoard. If they agree, the
comparison can be run on three months and the decision follows quickly.

**A usable answer:** a named figure for each of 2026-05, 2026-06 and 2026-08 from **both**
methods, and a one-line statement of which is authoritative and on what grounds.

### 3. Does the acceptance standard still stand?

**The question:** do we keep the standard as agreed, or restate it?

**Context.** It was agreed as: **every month within 0.5 percentage points** of the manual
figure, and **no month landing in a different performance tier** (bands 85 / 80 / 75). Then
the measurement-parameter correction moved **every 2026 month up by 1.6–2.4 points**, and
**two of the three decision months changed tier as a result** — 2026-06 (84.42 → 85.92) and
2026-08 (83.62 → 85.30), both Warning → Meets at the 85 boundary. All three decision months
now read Meets, where only one did before.

**Why it changes what happens next.** A standard written to detect a tier change is now
being applied to figures whose tiers have already changed, for a known and accepted reason.
The tolerance criterion survives untouched; the tier criterion was calibrated on the
assumption that two months sat below 85, and that assumption is gone. Restate it before the
comparison is run, or the pass/fail answers a question nobody is asking. Note too that the
test no longer exercises the 80–85 band at all — if a warning-band month is wanted,
2026-09 **raw** (81.20%) is the only candidate.

**A usable answer:** a restated standard in one or two sentences — the tolerance in points,
and what a tier change means now. Thirty minutes, after question 2 produces real manual
figures and before anything is compared.

### 4. Are `2/5/10/60` contractual, or just what Avail's BI defaults to? *(T4.7)*

**The question:** are those four values named in the contract, who at MVTA owns a change to
them, and how would a change be noticed?

**Context.** This already went wrong. OnBoard asked Avail for `1/5/15/30` for months
against MVTA's configured `2/5/10/60`, and **nobody noticed, because nothing declared what
the governed values were.** The early threshold is the one that bit: at 1 minute, a
departure 1–2 minutes early counted as early where MVTA's own standard counts it on time.
It was worth **1.0–1.8 points per month**, and it made the agency look worse than its own
standard says it is. The values are now declared in a dated, sourced register with an audit
trail (migration 151, ADR 0042) — but **that records what we believe, not what the contract
says.**

**Why it changes what happens next.** Changing any one of those values **restates every
figure the feed has ever stored.** It is not a tuning knob, and it needs a named owner the
way a rate or a penalty does.

**A usable answer:** a document reference if the values are contractual, or "not in the
contract" if they aren't; and a named person who owns a change.

### 5. Weather days — how does MVTA handle a snow day today? *(T4.1)*

**The question:** who approves a weather exclusion today, on what evidence, and does the
contractor see the adjustment before the month is assessed?

**Context.** OnBoard can now subtract an approved date: the departures that date carried
are frozen at the moment of approval and removed from the assessable figure, approved from
the Weather page. Nothing has ever been approved on dev — there are **zero date exclusions
in the system**, so the feature is live and untested against real practice.

**Two limits to state plainly.** A date **before 2026-09-14** cannot be evidenced from the
daily feed, which only goes back that far — an earlier date can still be approved, but its
departure counts cannot be substantiated from OnBoard's own data. And **holidays are
deliberately not excluded**; reduced-service skew is built but held, because adding a second
subtraction mid-validation would invalidate the comparison.

**Why it changes what happens next.** If the existing process gives the contractor notice
and a right of reply, OnBoard's approval flow is missing a step. If it doesn't, we are
automating an informal practice and should say so.

**A usable answer:** the approving role by name, the evidence it rests on, and yes/no on
whether the contractor sees it first.

### 6. Is the exclusion queue under-reviewed? *(T4.4)*

**The question:** does the volume of stop exclusions match how often OCC believes recovery
and layover stops distort the figure?

**Context.** Setting September's test data aside, dev holds **six stop-exclusion decisions
in total** — three approved and three rejected, all for 2026-07, all by one reviewer within
twenty minutes on 2026-08-06 — and **no date exclusions at all**. The approved ones move
the figure by hundredths of a point. *(The closeout said nine decisions across nine months;
dev shows six. Trust dev.)*

**Why it changes what happens next.** There are only two readings. Either recovery and
layover stops distort the official number far less than OCC believes — in which case the
queue is a formality and the raw figure is close to the assessable one — or **nobody is
working the queue**, and the assessable figure is understating a real adjustment. The first
is a finding. The second is a control gap, and it would have to be closed before OnBoard
could be the record.

**A usable answer:** roughly how many stops OCC expects to exclude in a typical month, and
who is supposed to be working the queue.

### 7. Who classifies new Avail RouteIDs before a month closes? *(T4.5)*

**The question:** who confirms that every RouteID appearing in a month has been classified,
and at what point in the month-end cycle?

**Context.** Thirteen routes are classified today — eight special event, four non-revenue,
one on-demand. **An unclassified route counts as fixed route by default.** So a new
special-event or shuttle route that Avail starts reporting mid-month enters the official
figure silently, with nobody notified.

**Why it changes what happens next.** This is the one failure mode in the module that
produces a wrong official figure with no error, no flag and no audit entry. It needs an
owner and a checkpoint, or a build that blocks a month from closing while an unclassified
RouteID carries departures.

**A usable answer:** a named role, and where in the month-end cycle the check sits.

### 8. Are the twelve reason codes the vocabulary OCC and the contractor actually use? *(T4.6)*

**The question:** are the six stop codes and six date codes the words used in a real
dispute?

**Context.** Twelve codes exist and are confirmed on dev. They were drafted from the module
design, not transcribed from dispute correspondence. A reason code is what appears on the
record when the contractor asks why a stop came out of the figure.

**Why it changes what happens next.** If the vocabulary doesn't match, every exclusion
recorded from here is filed under a label the dispute process doesn't recognise, and
renaming them later rewrites history. Cheap to fix now, awkward later.

**A usable answer:** confirmation, or a list of the words OCC and the contractor actually
use.

### 9. Should OnBoard own contractor notification? *(T4.2)*

**The question:** is notifying the contractor of an adjustment a manual step today, and
should OnBoard own it?

**Context.** The Weather page shows **"notified / acknowledged"** against each date.
OnBoard sends nothing and sets neither flag. They are fields with no mechanism behind them.

**Why it changes what happens next.** Two fields displaying a status nothing maintains is
worse than no fields at all — a reviewer will read "not notified" as a fact. Either OnBoard
sends and records it, or the fields become a manual check-box with a stated owner, or they
come off the page.

**A usable answer:** yes/no on OnBoard owning it. If no, who does, and should the fields
stay as a manual record?

### 10. Must a closed month stay closed? *(T3.9)*

**The question:** is it right that a finalized month does not restate?

**Context.** On a finalized month, if a new exclusion is approved, **Monthly Assessments
keeps showing the figure the contractor was shown**, labelled as not recalculated, while
**Route Summary shows today's live figure.** The two pages diverge, on purpose.

**Why it changes what happens next.** That divergence is the mechanism that stops a closed
assessment moving under the contractor's feet, and it is the single most important control
in the module. But it means two console pages show different numbers for the same month,
and anyone who finds that without knowing why will report it as a defect. **You have to
agree it is the right behaviour**, and that agreement has to be written down — because the
alternative design (restate and record the restatement) is also defensible, and switching
later is a schema change, not a setting.

**A usable answer:** yes/no, with a sentence on what the contractor is entitled to see.

---

## What happens after the answers

- **Questions 1–3 answered** → the comparison can be run on 2026-05, 2026-06 and 2026-08.
- **Questions 4–10 answered** → filed into the validation plan's Tier 4 section as recorded
  decisions, not pass/fail results.
- **Then** one sitting with OCC for Tier 3, and sign-off: approve, approve with named
  conditions, or not yet with a statement of what would have to change. Conditions go in the
  sign-off table, not in an email.

Nothing on this list is waiting on Avail. As of 2026-10-29 nothing with Avail is on the
critical path, which is a change from where this started.

---

*Figures in this document were verified against dev on 2026-11-01 —
`dbo.OtpMonthlyRouteStopDay`, `dbo.OtpStopExclusions`, `dbo.OtpDateExclusions` and
`dbo.vw_OtpMonthlyRouteStop`. Where a figure disagreed with the 2026-10-31 closeout, dev is
quoted and the difference is noted inline.*
