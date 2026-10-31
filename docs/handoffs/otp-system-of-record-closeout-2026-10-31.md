# OTP system of record — what is left, who answers it, and in what order

**Date:** 2026-10-31. **Companion to** `otp-compliance-validation-plan-2026-09-22.md`,
which holds the test cases. This document holds only the closeout: the open questions,
the order they have to be answered in, and what "done" looks like for each.

**The short version.** The technical half is finished. Every month of 2026 is measured
with MVTA's own parameters, and Avail's own BI report agrees with OnBoard to 0.10 points.
What is left is a decision, and almost all of it needs Rob rather than a build. Two things
gate everything else, and neither is code.

---

## Where it stands

| | State |
| --- | --- |
| **Months measured consistently** | **Yes.** All ten 2026 months re-pulled, every row stamped `2/5/10/60/0/1/1` |
| **Tier 1 — OnBoard holds what Avail published** | **Passed** for 2026-08 and 2026-09 against Avail's own BI pull; 2026-03 failed and was **repaired 2026-10-30** (90.46% → 90.50%) |
| **Tier 2 — rule correctness** | **Passed** 2026-09-22, except **T2.4**, which has no live evidence |
| **Tier 3 — workflow controls** | **Not run.** Needs an hour with OCC |
| **Tier 4 — process fit** | **Open.** Ten questions, all Rob's |
| **A0 — the two manual artifacts agree with each other** | **Not started. This is the gate.** |
| **Acceptance standard** | **Stale.** Written against figures that no longer exist |

### The figures everything will be compared against

Raw agency OTP, all measured on `2/5/10/60/0/1/1` as of 2026-10-31:

| Month | Raw % | Departures | | Month | Raw % | Departures |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-01 | 90.63 | 61,203 | | 2026-06 | **85.92** | 65,284 |
| 2026-02 | 90.96 | 58,328 | | 2026-07 | 84.86 | 64,411 |
| 2026-03 | 90.50 | 67,330 | | 2026-08 | **85.30** | 62,748 |
| 2026-04 | 89.13 | 68,582 | | 2026-09 | 81.20 | 62,538 |
| 2026-05 | **87.56** | 67,532 | | 2026-10 | 83.78 | 63,443 (accruing) |

Bold are the three decision months. 2026-09's *assessable* figure is not usable — see
step 1b.

---

## The questions

### Gate questions — nothing downstream means anything until these two are answered

**Q1. Which manual artifact is the baseline?** Two exist: a weekly CSV from Avail summed
in a spreadsheet, and a canned Avail report run monthly. They have never been compared to
each other. If they disagree, the finding is about the manual process and OnBoard cannot
be validated against either until MVTA says which one is authoritative, and why.
*Owner: Rob. This is A0, and it is the gate.*

**Q2. Does the acceptance standard still stand?** It was agreed as: every month within 0.5
points, and no month tiering differently. The correction moved every 2026 month up by
1.6–2.4 points, and **two of the three decision months changed tier as a result** — June
and August both moved Warning → Meets at the 85 boundary. So a standard written to detect
a tier change is now being applied to figures whose tiers already changed for a known and
accepted reason. Restate it before testing, or the pass/fail answers a question nobody is
asking. *Owner: Ty + Rob.*

### Contract questions — these can invalidate the comparison itself

**Q3. Departures or arrivals?** OnBoard measures departures. If the contract or existing
reporting measures arrivals, Tier A is not a reconciliation of two methods, it is a
comparison of two different metrics. The manual notes record a 36-point divergence on one
route in one week, so this is not academic. *T4.3. Owner: Rob. Ask this before A0, because
a wrong answer makes A0 pointless.*

**Q4. Are `2/5/10/60` contractual, or just what Avail's BI defaults to?** OnBoard sent
`1/5/15/30` for months and nobody noticed, because nothing declared what the governed
values were. That is now fixed — they are declared in a dated, sourced register
(migration 151) — but the register records what we believe, not what the contract says.
Who at MVTA owns a change to them? Changing any one of them restates every figure the feed
has ever stored, so it is not a tuning knob. *T4.7. Owner: Rob.*

### Process questions — decisions to record, not tests to pass

**Q5. Weather days.** OnBoard can now subtract an approved date. How does MVTA handle a
snow day today, who approves one, and does the contractor see the adjustment before the
month is assessed? Two limits to state: a date before 2026-09-14 cannot be evidenced from
the daily feed, and holidays are deliberately not excluded. *T4.1.*

**Q6. Is the exclusion queue under-reviewed?** Nine genuine decisions across nine months,
moving the figure by hundredths of a point. Either recovery and layover stops distort the
number far less than OCC believes, or nobody is working the queue. *T4.4.*

**Q7. Who classifies new Avail RouteIDs before a month closes?** An unclassified route
counts as fixed route by default, so a new special-event route silently enters the official
figure. *T4.5.*

**Q8. Are the twelve reason codes the vocabulary OCC and the contractor actually use?**
*T4.6.*

**Q9. Should OnBoard own contractor notification?** The Weather page shows
"notified / acknowledged" and OnBoard sends nothing and sets nothing. *T4.2.*

**Q10. Must a closed month stay closed?** On a finalized month, Monthly Assessments shows
the figure the contractor was shown while Route Summary shows today's live figure. That
divergence is deliberate — it is what stops a closed assessment moving under the
contractor's feet — but Rob has to agree it is right. *T3.9.*

### Ours, not blocking

**Q11.** Did any pre-correction 2026 figure go out externally — to the contractor, a board
packet, a report? Every month now reads 1.6–2.4 points better. If any did, it needs
restating, and that is a communication rather than a defect.

**Q12.** Do we delete the eleven rows across 2026-05/08/09 that Avail no longer reports?
The MERGE never deletes, so a route/stop/day Avail has dropped keeps its last figure
forever. Deleting history on a feed's say-so is a decision, so it is written down rather
than acted on.

### With Avail — asked, not blocking

**Q13.** Is there a stable stop-record identifier or an effective date on the monthly
operation? A mid-month stop rename splits that month into two records per key, which cost
March 855 departures. We sum them now, correctly, but it will recur at the next rename and
we would rather key on an identifier than infer one. *Drafted in
`avail-reply-2026-10-29.md`.*

**Q14.** Does the API read `09-01-2026` as 1 September rather than 9 January? Belt and
braces — every monthly call we make uses day `01`, so the format is ambiguous and we have
only inferred the answer. *Same draft.*

---

## The steps, in order

The order matters more than the content. Steps 2 and 3 are the only ones that cannot start
today, and everything after step 4 is wasted effort if step 2 fails.

### Step 1 — Clear the ground (us, this week)

**1a. Prove the classification filter on live data (T2.4).** All thirteen classified routes
carry zero OTP rows, so the fixed-route filter has never removed anything. Classify one
live route temporarily, confirm it drops out of the official figure, then remove the
classification. Twenty minutes, and it closes the last open Tier 2 case.

**1b. Clear September's exclusion decisions.** 178 approved and 183 rejected, all by one
reviewer between 15:23 and 17:01 on 2026-10-15, removing 14,813 of 62,538 departures. That
is test data and it makes September's assessable figure meaningless. September is not a
decision month, so this does not block Tier A — but it has to go before anyone reads a
September assessable figure, and it is itself the evidence for Q6.

**1c. Run T1.1–T1.3 formally on 2026-08.** The method is proven and the result is not in
doubt — Avail's own BI pull settled it for September — but 2026-08 is the designated control
month and the plan asks for it on the record. Expect 62,748 departures, 53,527 on time,
85.30%.

**1d. Send the Avail reply.** Drafted, and includes Q13 and Q14. Nothing waits on the answer.

### Step 2 — Answer Q3, then Q1 (Rob) — THE GATE

Ask Q3 first. It takes one conversation and a wrong answer makes the rest pointless.

Then A0: produce both manual artifacts for 2026-05, 2026-06 and 2026-08, and compare them
**to each other**, not to OnBoard. Expect them to agree. If they do not, stop and record
both figures and which is authoritative — that decision is worth writing down whatever
happens to OnBoard.

Account for the week boundary rather than letting it masquerade as a discrepancy: the week
containing 1 June also contains the end of May, so a weekly sum cannot align to a calendar
month. Split the boundary weeks or quantify the effect.

**Done looks like:** a named authoritative manual figure for each of the three months, and
a stated reason for the choice.

### Step 3 — Restate the acceptance standard (Ty + Rob)

Q2. Thirty minutes, and it must happen after step 2 produces real manual figures and before
step 4 compares anything. Specifically: decide what a tier change means now that two
decision months changed tier for an accepted reason.

### Step 4 — The comparison (A1–A4)

Only now. OnBoard's official figure is the assessable figure from Route Summary. Record the
raw figure alongside it — if raw agrees with the manual figure and assessable does not, the
entire difference is in the exclusions, which is a conversation about process rather than
about data.

Then explain every gap above 0.1 points against A3's list, and state the direction: a
consistent bias is a defect and will be worse in the months nobody checked; scatter inside
tolerance is what a pass looks like.

### Step 5 — Tier 3 with OCC (one sitting, ~1 hour)

T3.1 through T3.9. These are the controls around the number — who can change it, whether
the change is recorded, whether a closed month can move. Set the flagging threshold back to
0.15 afterwards.

### Step 6 — Record the Tier 4 decisions (Rob + Ty)

Q5 through Q10. Not pass/fail. Write the answers into the plan's Tier 4 section, not into
an email.

### Step 7 — Sign off (A5)

Approve OnBoard as the system of record, approve it with named conditions, or do not
approve it yet and say what would have to change. Conditions go in the sign-off table, not
in an email.

---

## What is deliberately not on this path

- **Holiday / reduced-service skew.** Built and passing, held on
  `claude/otp-reduced-service-declared` until Tier A returns. Adding a second subtraction
  mid-validation would invalidate the comparison.
- **PR #391** (OTP month target and figures split). Draft, held for the same reason.
- **Q11 and Q12.** Ours to decide, neither gates the decision.
- **Anything to do with Avail.** Q13 and Q14 are asked and not blocking. As of 2026-10-29
  nothing with Avail is on the critical path, which is a change from where this started.

---

## The one-line framing for the conversation with Rob

The plan was written expecting OnBoard to be the uncertain party. It isn't any more —
Avail's own reporting agrees with it to a tenth of a point. The open question is now
whether the manual process agrees with itself, and that is a question about the manual
process.
