# Contractor Ridership Briefing

Date: 2026-10-31. **Draft for MVTA. Nothing here has been sent to either
contractor.** It sets out what MVTA tells its operations contractor about
fixed-route ridership counting, in two parts:

1. **The current process**, what the contractor is responsible for today, and
   where today's practice falls short of the contract and OPR-038.
2. **The updated process**, change by change, with what the contractor must
   do, who does it, the training it needs and the evidence MVTA will look at.

It ends with a proposed actions table, talking points for the Keolis kick-off,
and the decisions MVTA still has to make.

**Two audiences, kept apart throughout:**

| Audience | Period | Their part |
|---|---|---|
| **Incumbent contractor** (SST, today's OCC and garages) | Now through 2026-12-31 | Today's process, then the **December parallel run**: OnBoard-printed sheets, entered in both Access and OnBoard |
| **Keolis** | From 2027-01-01 | OnBoard only, with flags, month close and, later, `INCIDENT_REPORTING` occurrences, the kiosk and phones |

**Sources.** Gap IDs (C1–C8, P1–P7, D1–D6, H1–H2) are from
`plans/ridership-counting-gaps.md`. Spec sections (§2, §5 …) are from
`plans/ridership-counting-spec.md`. Both are in PR #455, with the procedure
draft `plans/ridership-counting-procedure-draft.md` and the build plan
`plans/ridership-build-plan.md`. Other sources:

- the SOP drafts on `claude/ridership-sop-3b06a2` (`plans/sop-drafts/`): the
  OPR-038 amendment (01), the new SOP **OPR-RID-00** (02, a placeholder code),
  and the decisions before issue (03);
- the reconciliation review (PR #459, gaps R1–R12);
- the operator app design (PR #458, decisions D1–D25);
- the kiosk evaluation and hardware notes (PRs #461, #462);
- `INCIDENT_REPORTING` in `migration-030`: Medium priority, entered by hand
  today, $500 per occurrence (`per_unit`);
- OPR-038-00 as it stands, and the 2026-10-23 → 10-30 "Ridership Database
  Procedures" email thread, both in the untracked `ridership/` folder and read
  there. No names or contact details from them are used here.

ServiceType (Q15) is unsettled. Nothing here depends on it.

---

## 1. The current process and its shortfalls

### 1.1 The contract clause

The clause is in the main operations contract, not Attachment G:

- **Operators count** passengers on **all trips**, in accordance with MVTA's
  procedures and standards, and record the counts **accurately** and **in a
  timely manner**.
- **The Contractor trains, supervises and monitors** its employees, and
  ensures that the ridership counting and reporting procedures **provided by
  MVTA** are implemented and consistently followed.

Attachment G carries only the penalty. The candidate standard is **Incident
and Data Reporting** (`INCIDENT_REPORTING`).

The clause holds the contractor to **MVTA's procedures**, so the contractor's
duty is only as precise as what MVTA has written down. Several of the
shortfalls below are therefore **MVTA's to fix first**, before the contractor
can be held to anything.

### 1.2 What the contractor does today

Each line is written to be checked: a person can watch it happen or ask for
the record.

| # | Step | Who at the contractor | What happens today | Where it is written | Can MVTA check it? |
|---|---|---|---|---|---|
| T-1 | **Count Sheet issued** | Check-in desk, under the Garage Manager | Each Operator gets a paper Count Sheet in the run packet at check-in. It lists the run's trips by route and time range, one total per trip. **Who produces the sheet is not recorded**: the email thread asked whether the contractor creates it and got no answer. | OPR-038, Check-In step 3 | Partly: ask the desk to show a blank sheet and where it comes from |
| T-2 | **Counting** | Operator | Writes one boardings total per trip on the sheet. | OPR-038, Ridership Counting. But OPR-038 says boardings **and alightings**, **at each timepoint** (C1) | No: there is no record of how a count was made |
| T-3 | **APC buses** | Operator, Garage Manager | OPR-038: on a bus with APC, verify it is active at pull-out, and also complete the paper sheet **unless the Garage Manager confirms APC is sufficient** for the route (C8). | OPR-038 | No: no record of any such confirmation, and no criteria for "sufficient" |
| T-4 | **Hand-in** | Operator → check-in desk | The sheet is handed in at the end of the block or at pull-in, whichever comes first. It must not be altered after hand-in. | OPR-038, Ridership Counting and Pull-In step 3 | No: nothing lists the sheets expected against the sheets returned |
| T-5 | **Lost or damaged sheet** | Operator, OCC, Garage Manager | The Operator tells the OCC and the Garage Manager at pull-in, and reconstructs the counts "as accurately as possible". | OPR-038, Ridership Counting and Escalation Matrix | No: a reconstructed sheet is not marked as one, and Access cannot record it |
| T-6 | **Collection to OCC** | Check-in desk → contractor OCC | Contractor OCC staff check the desks **2–3 times a day on average** and collect the sheets. | Email thread only (C5) | No |
| T-7 | **Entry** | Contractor OCC staff | Each sheet line is keyed into the Access "Recent Riders SST DATA ENTRY" form. OCC matches each line to a roster row **by route and time, by hand**, because the sheet has no trip ID or direction (D2), and some rows have a blank TripID (D1). **There is no deadline** (C2). | Email thread only (C5) | No: Access does not record who keyed a row or when (P6) |
| T-8 | **Corrections** | Contractor OCC staff | Monthly, MVTA Planning emails missing and outlier trips to the contractor's OCC, who correct them in Access. | Email thread only | No: no record of what was flagged, changed or by whom (P6) |
| T-9 | **Month close-out** | Contractor OCC with MVTA Planning | Planning "confirms with contractor OCC staff the close-out" of the month. | Email thread only | No: the close records no who or when (P7) |
| T-10 | **Retention** | Garage Manager | Paper sheets are kept "until monthly ridership is closed out" (email). OPR-038's Required Records says the Garage Manager keeps them at the garage collection point "per MVTA records retention schedule". | Email (C6); OPR-038 Required Records | Partly: MVTA can ask for a past sheet |
| T-11 | **Handling** | Garage Manager | Sheets carry the Operator's name and ID. No handling rule beyond retention (H2). | Nowhere | No |
| T-12 | **Special events** | Contractor | Count sheets for special events go to MVTA Planning on paper, "unless otherwise completed digitally", with no rule for which (C7). | Email thread only | No |
| T-13 | **Training** | Contractor Training and Safety | OPR-038 makes Training and Safety responsible for initial and refresher training on **all** OPR-038 procedures, which includes ridership counting, and for keeping training records. Whether ridership is actually covered, and how, is **unknown**. | OPR-038, Responsibilities and Training | Yes: ask for the training content and records |
| T-14 | **Supervision and monitoring** | Garage Managers, contractor operations management | No ridership monitoring is described anywhere. Missing sheets show up only as blanks when Planning reviews the month. | Nowhere | No |

### 1.3 Measured against the contract clause

| Clause term | Today | Verdict |
|---|---|---|
| **"all trips"** | Nobody checks expected sheets against returned sheets (T-4). A blank in Access can mean not counted, did not operate or not keyed yet, and these can't be told apart. Trippers and extras have no roster row, so they cannot be keyed at all. | **Not measurable.** The contractor can't show it counts all trips, and MVTA can't show it doesn't. |
| **"accurately"** | Planning's check is to sort largest to smallest and look (C3, P4). September 2026 was +27% on flat trips, and nobody has explained it (D3). Hand matching by route and time (D1, D2) adds keying errors that are not the Operator's. | **No test exists.** An accuracy failure cannot be shown. |
| **"in a timely manner"** | "2–3 times a day" is a habit, not a standard (C2). Access records no entry time. | **No standard and no evidence.** |
| **"MVTA's procedures"** | OPR-038 says boardings and alightings at each timepoint. The sheet MVTA's process uses asks for one total per trip (C1). The OCC entry flow is written only in an email thread (C5). | **MVTA's own shortfall.** Two MVTA documents conflict, and the procedure the contractor is meant to follow has not been provided in writing. |
| **"trains"** | OPR-038 requires training on its procedures, but the ridership procedure in OPR-038 is the one nobody follows (C1). | **Unknown.** Ask for the records. Training on a conflicting SOP would be training on the wrong thing. |
| **"supervises and monitors"** | No ridership monitoring exists at the contractor or at MVTA beyond the monthly blank-and-sort (T-14). | **Not met in any form MVTA can see.** But MVTA gives the contractor nothing to monitor against: no deadline, no completeness list, no accuracy rule. |
| **Enforcement** | Attachment G has no ridership KPI (C4). `INCIDENT_REPORTING` is entered by hand and has never been used for ridership. | **No enforcement path.** |

### 1.4 Measured against OPR-038

Where today's practice and OPR-038 disagree, the contractor is technically out
of compliance with the SOP, but on points MVTA itself does not follow:

1. **Boardings and alightings, by timepoint (C1).** OPR-038 requires both, at
   each timepoint. Every sheet today records one boardings total per trip.
   Every Operator is out of step with OPR-038, because the sheet does.
2. **APC exception (C8).** OPR-038 lets the contractor's Garage Manager excuse
   the paper sheet where APC is "sufficient". There are no criteria, no record
   of any such decision, and the one APC sample (2026-10-28) shows 2 of 144
   blocks with all-zero counts. **This exception should be closed** (the
   OPR-038 amendment does so: only MVTA, in writing).
3. **Retention (C6).** OPR-038 says "per MVTA records retention schedule"; the
   email says "until monthly ridership is closed out". These are different
   rules, and neither has been tied to the performance assessment's dispute
   window.
4. **No timeliness, accuracy or completeness rule** appears in OPR-038 at all
   (C2, C3), so the contract's three terms have no measure in the SOP either.

### 1.5 All gaps, by who they bind

So that the contractor is not briefed on gaps that are MVTA's own:

| Gap | What it is | Binds |
|---|---|---|
| C1 | SOP and sheet disagree | **MVTA**: amend OPR-038 (draft 01) |
| C2 | No timeliness standard | **MVTA** sets it (next-day deadline); **contractor** meets it |
| C3 | No accuracy test | **MVTA** sets it (flags); **contractor** answers flags |
| C4 | No enforcement path | **MVTA**: confirm `INCIDENT_REPORTING` applies (decision O-3) |
| C5 | No written procedure | **MVTA**: issue OPR-RID-00. The clause makes this MVTA's job |
| C6 | Retention only in email | **MVTA** writes it; **contractor** keeps sheets |
| C7 | Special events | **MVTA**: out of scope of OPR-RID-00 for now; tell the contractor the current practice continues |
| C8 | APC exception, no criteria | **MVTA**: removed from the Garage Manager by the amendment |
| P1, P3, P4, P5, P7 | Roster build, silent failure steps, by-eye close, one-person knowledge, close with no record | **MVTA Planning** only. Not for the contractor briefing |
| P2 | Every count written twice by hand | **Both.** It is the contractor's OCC workload, and stays so (paper + keying) until the kiosk |
| P6 | Corrections by email, no record | **Both.** The contractor's answers to MVTA's questions are not recorded today |
| D1, D2 | Blank TripIDs; sheet has no trip ID or direction | **MVTA's tools**, but they cause **contractor keying errors** today |
| D3 | September +27% unexplained | **Ask the incumbent**: any change in how sheets were filled in or keyed in September? |
| D4, D5 | Connect counting rule and UTC month | **MVTA** only (Spare). Not the contractor |
| D6 | ServiceType and day-type codes undefined | **MVTA** only. Unsettled; not for the contractor |
| H1 | Connect export with rider PII by email | **MVTA** only |
| H2 | Sheets carry Operator name and ID, no handling rule | **Contractor** keeps them; **MVTA** writes the rule (OPR-RID-00 Retention and Handling) |

### 1.6 What to ask the incumbent before December

These facts are not on record, and the December parallel run depends on some
of them:

1. Who produces the Count Sheet today, and how a run's sheet is matched to the
   run.
2. How many garages and check-in desks, their staffed hours, and their printers
   (sets the overnight print time, SOP decision 3).
3. How many OCC staff key ridership, on which shifts, and their names for
   OnBoard accounts.
4. Whether ridership counting is in the Operator training content, and the
   records.
5. Where paper sheets are kept now, how far back, and how they are destroyed.
6. Anything that changed in September 2026 that could explain D3.
7. Whether any Garage Manager has used the OPR-038 APC exception (C8).

---

## 2. The updated process, change by change

The OPR-038 amendment and OPR-RID-00 describe the stages by **MVTA's written
notice** rather than fixed dates (SOP decision record), so that the SOP stays
correct if a date slips. The dates below are the planned dates for those
notices.

### Change 1 — 2026-12-01: OnBoard Count Sheets, OnBoard entry, the deadline

**Audience: the incumbent contractor.** Keolis is told the same rules now, and
performs them from 2027-01-01 (change 3).

**What changes:**

- **Count Sheets are printed from OnBoard** each night for the next service
  date: one per block, listing each trip's route, direction, scheduled start
  and end, trip ID and a QR code. Operator and bus are blank. Each row takes a
  total or **DNO** (did not operate), and three blank rows take unscheduled
  trips.
- **OCC enters in OnBoard**, from a worklist of sheets still to enter, late
  first. The Operator, Operator ID and bus are **pre-filled from Avail's
  pull-out report**; OCC changes them when the sheet says otherwise, and the
  sheet wins. Each trip is a number, **Not counted** or **Did not operate**.
  Unscheduled trips are added with a reason. Reconstructed sheets are ticked.
- **Completeness and the deadline.** Every scheduled revenue trip needs a
  count unless a missed-trip case confirms it missed. A sheet is **late** if
  it is not entered by **the end of the calendar day after the service date**
  (Central). Monday's service is due by 11:59 p.m. Tuesday. The completeness
  view shows gaps and late sheets by garage and date.
- **OPR-038 is amended**: one boardings total per trip; the Garage Manager's
  APC exception is removed; the full procedure is OPR-RID-00.

| Who at the contractor | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operators** | Write name, Operator ID and bus on the sheet; one boardings total per trip, at the end of the trip, with the bus stopped; **DNO** for a trip that did not run, never 0; unscheduled trips in the blank rows; **Reconstructed** across the top of a rewritten sheet; count on APC buses too | A short briefing at check-in or in a bulletin, with a filled-in example sheet. The count itself (one total per trip) is what they already do | Sheets on request; reconstructed rate by garage and Operator; Not counted rate |
| **Check-in desk / Garage Managers** | Print the next day's sheets every night; check one has printed for every block on the pull-out list; issue the right sheet at check-in; check each returned sheet (name, ID, bus, every row filled) before the Operator leaves; chase missing sheets the same day | Hands-on: printing from OnBoard, reprinting one block, what to do if OnBoard can't print (SOP decision 4) | Every block that operated has a sheet entered; missing sheets by garage |
| **Contractor OCC staff** (`ridership-recorder`) | Enter every sheet in OnBoard by the deadline; override operator or bus to match the sheet; add unscheduled trips; tick Reconstructed; review the completeness view daily | OnBoard entry session plus the dry run (actions A-9, A-10) | OnBoard entry timestamps; late sheets; overrides recorded with who and when |
| **Contractor operations management** | Review completeness and timeliness at least weekly, by garage and Operator; act on repeat failures; request and remove OnBoard access | A walk-through of the completeness view | A weekly or monthly note of what was found and done |
| **Contractor Training and Safety** | Train every Operator, desk and OCC person on their part before they do it; record it | Train-the-trainer from MVTA | Training records, on request |

### Change 2 — December 2026: the parallel run

**Audience: the incumbent contractor only.** Keolis may observe (decision O-6).

**What changes:**

- Every sheet is entered in **both** OnBoard and Access, matched by block and
  start time. **Access remains the record for December.**
- MVTA Planning compares December's totals across the two systems, by route,
  direction and day type, using the daily comparison export (build plan PR 5).
- The deadline, completeness and reconstructed rules are **practised and
  reported, not assessed** (OPR-RID-00, Transition step 5).
- Flags and month close are **not yet in OnBoard** in December; they ship by
  2027-01-01 (spec §11). The incumbent keeps answering Planning's monthly
  questions by email as today.

| Who at the contractor | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Contractor OCC staff** | Key every sheet twice, once in each system, by the OnBoard deadline | As change 1; plus how to match an OnBoard trip to its Access row | Daily comparison: sheets in OnBoard but not Access and the reverse; trip-level differences |
| **Contractor operations management** | Staff the extra keying; tell MVTA early if the deadline is at risk | None new | Late-sheet rate through December |
| **Garage Managers** | Keep every December sheet until MVTA releases it, **and hand them over at contract end** (action A-17) | None | A sheet count by garage and date at handover |

**Two risks particular to the incumbent:** December is the last month of its
contract, so staff turnover is likely, and the double keying is new work at the
end of the term. Access being the record for December protects December's
reporting whatever happens in OnBoard. MVTA should still expect the incumbent
to ask whether the double keying is in scope (decision O-5).

### Change 3 — 2027-01-01: Keolis takes over; flags and month complete

**Audience: Keolis.**

**What changes:**

- **OnBoard is the only record** (the Cutover Date), if MVTA accepts
  December's comparison (decision O-4). The Access data-entry form is retired.
- Everything in change 1, now done by Keolis staff from day one.
- **Outlier flags.** OnBoard compares each count with the same trip over the
  previous 4 weeks, and flags one that is more than 3× the median and at
  least 10 above it, or 0 when the median is 5 or more. Planning can flag any
  count. **Not counted** trips and **DNO** that disagrees with the Dispatch
  Log are questions in the same queue. Keolis **corrects** the count from the
  paper or **confirms** it with a note. A flag is a question, not a finding.
- **Month complete by the 5th.** Keolis OCC marks the month complete in OnBoard
  once every flag is answered. Planning closes it by the 10th. After close, a
  count changes only if Planning reopens the month, and every such change is
  recorded.
- **Paper retention.** Keolis keeps the paper sheets until MVTA confirms the
  month's performance assessment is final and its dispute window has passed,
  stored securely, produced on request.

| Who at Keolis | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operators** | As change 1 | Ridership counting in new-hire and transition training, with the example sheet | Sheets on request; reconstructed and Not counted rates by Operator |
| **Check-in desk / Garage Managers** | As change 1 | Printing and issue, hands-on, before 2027-01-01 | Missing sheets by garage |
| **OCC staff** (`ridership-recorder`) | As change 1, plus: answer every flag from the paper sheet; mark the month complete by the 5th | OnBoard entry before 2027-01-01; flags and month complete in the first week of January, once they ship | Entry timestamps; flag answers and their dates; the month-complete date |
| **Operations management** | Weekly completeness review; corrective action on repeat failures; access requests and removals the day someone leaves | Completeness view walk-through | Their review notes; access removals on time |
| **Training and Safety** | Train and record, including annual refreshers | Train-the-trainer | Training records |

### Change 4 — early February 2027: `INCIDENT_REPORTING` occurrences

**Audience: Keolis.**

**What changes:**

- At month close, OnBoard proposes one **candidate occurrence per Count Sheet**
  (one block, one service date) that is **missing** at close, **entered late**,
  or carries a **flag still unanswered** at close. A sheet counts once,
  whichever of these apply. A Reconstructed sheet entered on time is not one.
- MVTA's **compliance manager** reviews each candidate with its evidence and
  confirms or dismisses it. Confirmed ones go to the Contractor Performance
  Assessment as **Incident and Data Reporting**, **$500 each**, with a
  corrective action plan after 3 or more in 30 days.
- The first month this could apply to is **January 2027** (closed by
  2027-02-10). The recommendation is that January is reported but **not
  assessed**, and assessment starts with **February 2027** service (decision
  O-1).

**Scale, so both sides see it.** A weekday is about 144 blocks, so 144 sheets.
One garage missing a day's deadline could produce dozens of occurrences, each
$500. That is the agreed unit; Keolis should hear it plainly at kick-off, and
MVTA should be sure it wants that exposure before the notice goes out
(decision O-2).

| Who at Keolis | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operations management** | Read the monthly candidates; raise any dispute through the assessment's dispute process with the evidence (the paper sheet, the entry time) | How candidates are built and disputed | Disputes raised, and on what evidence |
| **OCC staff** | Nothing new. The occurrence follows from the deadline and the flags | None | As change 3 |

### Change 5 — later: the operator kiosk, then phones

**Audience: Keolis.** Nothing here is decided beyond PR #458's design, and none
of it starts before the March 2027 close.

- **Kiosk pilot at one garage**, no earlier than after the **March 2027** month
  close (two clean OCC-entry closes first). Operators sign in at a garage
  tablet with their Avail logon ID and a 6-digit OnBoard PIN, choose their run
  and key each trip's total from a paper tally. For 4 weeks OCC also keys that
  garage's paper and the two are compared. Then that garage stops OCC keying
  and the others follow.
- **The submission becomes the record.** For a submitted run, the paper is a
  tally card and is not kept or keyed.
- **Phones** only after MVTA consults the contractor and amends OPR-038, which
  bans personal devices on duty. Phone use is voluntary; the kiosk stays the
  fallback.

| Who at Keolis | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operators** | Sign in, choose the run, key the totals, submit at pull-in | A short hands-on session at the kiosk | Count source (kiosk / phone / OCC from paper / OCC from draft) by garage |
| **Check-in desk** (`operator-credential-admin`, name pending) | Issue one-time PINs, reset locked PINs, **disable a PIN the day an Operator leaves** | PIN issue and reset | PINs disabled on time |
| **Operations management** | Agree the work rules: kiosk time at pull-in is paid time; phone use is voluntary | None; a negotiation | A written agreement before the pilot |
| **OCC staff** | Submitted runs drop off the worklist; OCC submits saved drafts operators left; answers flags as before | Draft submission | Count source; drafts submitted by OCC |

---

## 3. Proposed actions

MVTA owners are roles, not names. "Operations" is MVTA Operations under the
COO; "Contracts" is whoever administers the operations contracts.

Dates assume the notice period recommended in decision O-7 (14 days). Note
Thanksgiving falls on **2026-11-26**.

| # | Action | Audience | Owner at MVTA | By when | Artifact |
|---|---|---|---|---|---|
| A-1 | Settle the SOP's open **[Decide]** items needed for issue: notice period (14), print time (3), print fallback (4), sheet trips to OCC per day (9), Contractor OCC staff (6), Attachment G route (7), and parallel-run acceptance (15) | Internal | Operations + Planning | 2026-11-06 | Decision note on the SOP draft |
| A-2 | Fact-finding meeting with the incumbent's operations and OCC leads: the seven questions in §1.6 | Incumbent | Operations | 2026-11-09 | Meeting, with notes |
| A-3 | Confirm with Contracts whether ridership reporting failures fall under `INCIDENT_REPORTING` as written in **both** contracts, and whether the December double keying is within the incumbent's scope (decisions O-3, O-5) | Both | Contracts | 2026-11-10 | Written opinion |
| A-4 | **Transition and kick-off meeting with Keolis** on ridership: today's process, the December run they inherit, the rules from 2027-01-01, the occurrence start, the kiosk later. Use §4's talking points | Keolis | COO, with Planning and Compliance | 2026-11-13 | Meeting, with talking points and the SOP drafts as read-ahead |
| A-5 | **Formal notice to the incumbent**: the amended OPR-038 and OPR-RID-00, the Parallel Run starting 2026-12-01, Access remaining the record, December practised and not assessed, and the paper handover at contract end | Incumbent | COO | 2026-11-13 (≥ 14 days before 12-01) | Letter, with OPR-038 redline and OPR-RID-00 |
| A-6 | **Formal notice to Keolis**: the amended OPR-038 and OPR-RID-00 as MVTA's procedure under the contract clause, effective for Keolis from 2027-01-01, with the planned Cutover Date and the compliance start and grace period (decision O-1) | Keolis | COO | 2026-11-20 | Letter, with OPR-038 redline, OPR-RID-00 and a sign-off copy (the SOP's Contractor Representative row) |
| A-7 | Collect named OCC staff (and, if decision O-8 says so, check-in desk staff) who will enter or print, from each contractor | Both | Operations | Incumbent 2026-11-13; Keolis 2026-12-04 | Email request with a fixed template (name, work email, role, garage) |
| A-8 | **OnBoard access, as numbered steps:** (1) apply migration 153 to prod; (2) MVTA IT creates **Entra B2B guest accounts** (Guest Sponsorship) on prod for the names from A-7; (3) an access administrator assigns **`ridership-recorder`** to each in Access & Identity on prod; (4) assigns **`ridership-manager`** to the named Planning staff; (5) each person signs in and confirms the Ridership tab shows. **The incumbent's OCC staff need this too**: they key December. The build plan names only Keolis | Both | MVTA IT + an access administrator; Engineering for step 1 | Incumbent **2026-11-20** (before the dry run); Keolis **2026-12-11** | OnBoard access |
| A-9 | **Training for the incumbent's OCC staff on OnBoard entry**: worklist, sheet form, override, unscheduled trips, Reconstructed, Not counted, completeness view, and matching to Access for December | Incumbent | Planning, with Engineering | 2026-11-23 → 11-24 | Training session (hands-on on prod with a test service date), with a one-page quick guide |
| A-10 | **Dry run before 2026-12-01**: (a) OCC keys a test service date end to end on prod; (b) each garage prints the next day's sheets from OnBoard on the night of 2026-11-29, checks them against the pull-out list and **does not issue them**; (c) go/no-go | Incumbent | Planning + Operations | (a) 11-24, (b) 11-29, (c) go/no-go 2026-11-30 | Dry run, with a go/no-go checklist |
| A-11 | Train the incumbent's check-in desks on printing, issue, the returned-sheet check and the print fallback | Incumbent | Operations | 2026-11-25 | Training session at each garage |
| A-12 | Operator briefing on the new sheet (DNO, blank rows, Reconstructed, name/ID/bus, no writing while moving) | Incumbent | Operations, through the contractor's Training and Safety | 2026-11-30 | Operational Bulletin with an example sheet |
| A-13 | Weekly December check-in with the incumbent: late and missing sheets, comparison differences | Incumbent | Planning | Each Friday in December | Meeting (30 min), with the comparison export |
| A-14 | Keolis training: OCC on OnBoard entry; check-in desks on printing; Operators on counting in their transition training; Training and Safety train-the-trainer | Keolis | Planning (OCC), Operations (desks, Operators) | 2026-12-18 | Training sessions on prod with a test service date; quick guides |
| A-15 | **Cutover notice**: OnBoard is the only record from 2027-01-01, based on the comparison of 12-01 → 12-15 (decision O-4) | Both | COO, on Planning's recommendation | 2026-12-18 | Letter |
| A-16 | Keolis OCC training on flags and month complete, once they ship | Keolis | Planning | 2027-01-08 | Training session |
| A-17 | Paper handover: the incumbent delivers every Count Sheet not yet released (at least November and December) to MVTA Planning, filed by garage and date | Incumbent | Planning | 2027-01-08 | Letter (in A-5); signed handover receipt |
| A-18 | Remove the incumbent's guest accounts and `ridership-recorder` grants | Incumbent | MVTA IT + an access administrator | 2027-01-01 (or after December's Access entry is done, decision O-4) | OnBoard access |
| A-19 | January reported, not assessed: share the would-be candidates with Keolis | Keolis | Compliance manager | 2027-02-12 | Letter with the January figures |
| A-20 | First assessed month (February 2027) closed and candidates confirmed | Keolis | Compliance manager | 2027-03-12 | Contractor Performance Assessment |
| A-21 | Monthly ridership line in the regular Keolis performance meeting: completeness, late sheets, flags, reconstructed rate | Keolis | Planning | Monthly from February 2027 | Standing agenda item |
| A-22 | Consult Keolis on the kiosk work rules and on amending OPR-038 for phones | Keolis | Operations | Before the kiosk pilot (no earlier than April 2027) | Meeting, then a written agreement |

---

## 4. Talking points for the Keolis kick-off

For action A-4. Plain enough to read aloud.

**Why this matters**

1. Ridership counts feed MVTA's service planning, funding and performance
   reporting. A missing or wrong count carries into all of them.
2. Your contract makes Operators count passengers on all trips, per MVTA's
   procedures, accurately and on time, and makes Keolis responsible for
   training, supervising and monitoring that. This is MVTA's procedure for
   that clause.

**What we are fixing first, on our side**

3. Today's written SOP (OPR-038) asks for boardings and alightings at every
   timepoint. Nobody does that. We are amending it to what is actually done:
   one boardings total per trip.
4. Today nothing defines "on time" or "accurate". We are giving each a rule,
   so you know exactly what you are measured on, and so are we.

**What you inherit on 2027-01-01**

5. Count Sheets come out of OnBoard each night, one per block, with every
   trip on it. Your check-in desks print them and hand them out.
6. Operators write their name, ID and bus, then one boardings total per trip,
   at the end of the trip, with the bus stopped. "DNO" if a trip did not
   run. Never 0 for a trip that did not run.
7. Your OCC staff enter every sheet in OnBoard by the **end of the next
   calendar day**. OnBoard pre-fills the Operator and bus from Avail; the
   sheet wins if they differ.
8. OnBoard asks questions about unusual counts. Your OCC staff answer each one
   from the paper sheet, correcting it or confirming it, by the **5th** of
   the next month, and then mark the month complete. MVTA closes it by the
   **10th**.
9. Keep the paper sheets, securely, until we tell you a month is final. They
   carry Operator names and IDs.

**How you'll be measured**

10. Each Count Sheet that is missing at month close, entered late, or has a
    question unanswered at close is a reporting failure under Attachment G's
    Incident and Data Reporting standard: $500 each, with a corrective action
    plan after three or more in 30 days.
11. MVTA's compliance manager reviews every one before it counts. A sheet the
    Operator lost and rebuilt, entered on time, is never a failure.
12. [If decision O-1 is accepted:] January 2027 is reported to you but not
    assessed. Assessment starts with February 2027 service.

**What we need from you, and when**

13. Names of the OCC staff who will enter sheets, and of the check-in desk
    staff who will print, by **2026-12-04**, so we can create their OnBoard
    accounts by 2026-12-11.
14. Time in your transition training for ridership: OCC and desks by
    2026-12-18; Operators in their onboarding.
15. A named lead at Keolis for ridership, who attends the monthly
    performance meeting.
16. [If decision O-6 is accepted:] your OCC staff to sit with the incumbent's
    OCC during the December parallel run.

**What's coming later**

17. A garage kiosk where Operators enter their own counts at pull-in, piloted
    at one garage no earlier than spring 2027. We will agree the work rules
    with you first.
18. Phones only after we consult you and amend OPR-038, and only voluntarily.

**Questions to ask Keolis**

19. Will you keep any of the incumbent's OCC or check-in staff?
20. Your training plan and dates for Operators before 2027-01-01.
21. Who in your organization will dispute an occurrence, and how.

---

## 5. Open decisions for the user

Each has a recommendation.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| **O-1** | **Compliance start date and grace period** | **January 2027 reported, not assessed. Assessment from service date 2027-02-01**, so the first confirmed occurrences come with the February close (by 2027-03-10). State it in the Keolis notice (A-6). | Keolis is new on 2027-01-01, with new staff, and flags and month complete ship only by 2027-01-01, so nobody can practise them in December. The deadline rule is practised in December, but by the incumbent, not Keolis. One month of shadow figures gives Keolis a fair start and gives MVTA a month to check the candidate rule on real data. *Alternative:* assess the deadline and missing sheets from 2027-01-01 and flags from February. |
| O-2 | Accept the per-sheet exposure | Keep one occurrence per sheet as agreed, but **check it with Contracts before A-6**, and consider whether a day's systemic failure (OnBoard down, a whole garage late) should be treated as one occurrence. | 144 sheets a weekday at $500 each makes one bad day large. Better settled before the notice than in the first dispute. |
| O-3 | Does `INCIDENT_REPORTING` cover ridership reporting failures as written, in **Keolis's** Attachment G? (SOP decision 7, gap C4) | Ask Contracts (A-3). If it does not, the occurrence stage waits for an amendment, and the rest goes ahead. | Without it, change 4 has no legal basis. |
| O-4 | **Cutover on 2027-01-01 before December has closed** | Issue a conditional cutover notice on **2026-12-18** based on the comparison of the first half of December. Access stays available, but not keyed, as a fallback (OPR-RID-00 Transition step 6). The incumbent finishes keying December in Access by 2027-01-02, or Planning does. | The SOP says cutover follows acceptance of a full month, but December is not complete until after the Keolis start. Keolis is not trained on Access, so a January in Access would need training nobody has planned. |
| O-5 | Is the December double keying within the incumbent's scope? | Treat it as within the clause ("procedures provided by MVTA"), but raise it at A-2 and agree it in A-5 rather than discover a claim later. | It is new work in the last month of a contract. |
| O-6 | Keolis OCC shadowing in December | Yes, if Keolis has staff in place and the incumbent agrees. Give Keolis guest accounts before shadowing. | It is the only way Keolis sees real entry before it counts. |
| O-7 | Notice period for each transition stage (SOP decision 14) | **14 calendar days.** | Enough for training and accounts; it still lets the incumbent's notice go on 2026-11-13. |
| O-8 | Who prints sheets: check-in desk staff with their own OnBoard accounts, or OCC printing for every garage | Check-in desk leads get guest accounts with `ridership-recorder`, one per garage per shift. | The spec gives "print sheets" to `ridership-recorder`, which only OCC staff hold, but the SOP has the desk printing. One of the two has to give. |
| O-9 | Paper sheets from the incumbent at contract end | Handover to MVTA Planning by **2027-01-08** (A-17). MVTA then holds them until each month is released. | Nobody at the incumbent is left to keep them, and they carry Operator names and IDs (H2). |
| O-10 | Special events (C7) | Tell both contractors that today's practice continues unchanged, outside OPR-RID-00, until MVTA writes a rule. | Keeps C7 out of the occurrence rule until it has one. |

Decisions already open elsewhere, which this briefing does not reopen: the
remaining SOP [Decide] items (`plans/sop-drafts/03-decisions-before-issue.md`);
the December sign-off tolerance (R6, PR #459); ServiceType (Q15).
