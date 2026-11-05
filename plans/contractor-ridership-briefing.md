# Contractor Ridership Briefing

Date: 2026-10-31, revised 2026-11-02. **Draft for MVTA. Nothing here has been
sent to either contractor.**

**What the 2026-11-02 revision changed.** It reflects work that landed after
the first draft:

- The Count Sheet printing process is decided, and the code is merged
  (#474–#485). Each garage's check-in desk prints the next day's sheets every
  evening, under a new **Ridership Printer** role (#483, migration 159). The
  morning desk reprints any sheet marked changed.
- Today's sheet turns out to be a **packet printed once per service change
  that operators photocopy every day**.
- Spec §16 records the Access screens and the Access TripID rule.
- The printed sheet design is recorded (digit boxes, a DNO tick box, corner
  marks, Avail trip numbers).
- Spec §15 and #458 decision 20 now say **the paper is still handed in and
  scanned** after the kiosk arrives.
- OCC entry and printing are **already live on prod** (onboard.mvta.com).
  Migrations 153, 154 and 157 are applied there; 159 is not yet.
- The reporting spec (#475) keeps operator names out of every export and out
  of Power BI.

Decision O-8 (who prints) is settled by the Ridership Printer role.

**Aligned with the merged SOP drafts (#486), 2026-11-02.** The SOP session
recorded decisions you made that this briefing had left open:

- O-1: assessment follows Attachment G's Transition and Ramp-Up Periods.
- O-4: conditional cutover, with Access kept as a fallback.
- O-7: 14 days' notice.
- Sheets go from the desk to OCC up to three times a day.
- A paper sheet is produced within one business day of MVTA asking.
- A flag raised after the 5th is answered within one business day.
- Interlined passengers are not counted again.

The sections below follow those decisions.

**Plan A, decided 2026-11-03.** The new Count Sheets start on the
**7 December 2026 service change** rather than on 1 December. December is a
**parallel run by scanning**:

- The desks print OnBoard sheets, and the incumbent's OCC keys Access as today.
- Garage management scans every sheet daily.
- Keolis's OCC staff key real scanned December sheets in OnBoard during their
  training, and Planning compares those entries with Access before the
  cutover notice.
- OnBoard entry, the deadline and flags start with Keolis on 1 January. Keolis
  never keys Access.

Changes 1 and 2, the actions and decisions O-4 to O-6 follow this. The SOP's
Transition section is updated to match in `plans/sop-drafts/`.

The briefing sets out what MVTA tells its operations contractor about
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
| **Incumbent contractor** (SST, today's OCC and garages) | Now through 2026-12-31 | Today's process to 6 December, then the **parallel run by scanning** from the 7 December service change: OnBoard-printed sheets, keyed into Access as today, scanned daily |
| **Keolis** | From 2027-01-01 | OnBoard only, with flags, month close and, later, `INCIDENT_REPORTING` occurrences, the kiosk and phones |

**Sources.** Gap IDs (C1–C8, P1–P7, D1–D6, H1–H2) are from
`plans/ridership-counting-gaps.md`. Spec sections (§2, §5 …) are from
`plans/ridership-counting-spec.md`. Both are in PR #455, with the procedure
draft `plans/ridership-counting-procedure-draft.md` and the build plan
`plans/ridership-build-plan.md`. Other sources:

- the SOP drafts, merged to main as #486 (`plans/sop-drafts/`): the OPR-038
  amendment (01), the new SOP **OPR-RID-00** (02, a placeholder code), and
  the decisions before issue (03);
- the reconciliation review (PR #459, gaps R1–R12);
- the operator app design (PR #458, decisions D1–D25);
- the kiosk evaluation and hardware notes (PRs #461, #462);
- spec §15 (the Count Sheet's journey: QR link, submission, scan) and §16
  (the Access screens and TripID rule), both on #455;
- the Count Sheet printing work (#474, #476–#478, #482–#485) and its findings
  note in this session group's shared notes folder;
- the ridership reporting spec (#475);
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
| T-1 | **Count Sheet issued** | Check-in desk, under the Garage Manager; Operators | A packet of sheets is **printed once per service change** (about four times a year). Each Operator **photocopies their run's sheet every day** on the garage copier. The sheet lists the run's trips by route and time range, one total per trip, and **carries no service date**, so a sheet cannot be tied to its day except by what is written on it. OPR-038 says the sheet comes in the run packet at check-in; in practice the Operator makes it. **Who prints the packet and keeps the master is not recorded.** | OPR-038, Check-In step 3 (which does not match the practice) | Partly: ask the desk to show the packet and the copier routine |
| T-2 | **Counting** | Operator | Writes one boardings total per trip on the sheet. | OPR-038, Ridership Counting. But OPR-038 says boardings **and alightings**, **at each timepoint** (C1) | No: there is no record of how a count was made |
| T-3 | **APC buses** | Operator, Garage Manager | OPR-038: on a bus with APC, verify it is active at pull-out, and also complete the paper sheet **unless the Garage Manager confirms APC is sufficient** for the route (C8). | OPR-038 | No: no record of any such confirmation, and no criteria for "sufficient" |
| T-4 | **Hand-in** | Operator → check-in desk | The sheet is handed in at the end of the block or at pull-in, whichever comes first. It must not be altered after hand-in. | OPR-038, Ridership Counting and Pull-In step 3 | No: nothing lists the sheets expected against the sheets returned |
| T-5 | **Lost or damaged sheet** | Operator, OCC, Garage Manager | The Operator tells the OCC and the Garage Manager at pull-in, and reconstructs the counts "as accurately as possible". | OPR-038, Ridership Counting and Escalation Matrix | No: a reconstructed sheet is not marked as one, and Access cannot record it |
| T-6 | **Collection to OCC** | Check-in desk → contractor OCC | Contractor OCC staff check the desks **2–3 times a day on average** and collect the sheets. | Email thread only (C5) | No |
| T-7 | **Entry** | Contractor OCC staff | In the Access *Ridership Data Manager*, OCC picks the **date and SST block**, and keys **Riders** against each of the block's trips by start time. Each row also has a free-text **Flag**. The form saves automatically. The sheet has no trip ID or direction (D2), so OCC matches each line to a trip by its time. Some route 495 rows have a blank TripID (D1). **What OCC types in Flag is unknown.** **There is no deadline** (C2). | Email thread only (C5) | No: Access does not record who keyed a row or when. Its *View by Date Entered* menu item is greyed out (P6) |
| T-8 | **Corrections** | Contractor OCC staff | Monthly, MVTA Planning emails missing and outlier trips to the contractor's OCC, who correct them in Access. | Email thread only | No: no record of what was flagged, changed or by whom (P6) |
| T-9 | **Month close-out** | Contractor OCC with MVTA Planning | Planning "confirms with contractor OCC staff the close-out" of the month. | Email thread only | No: the close records no who or when (P7) |
| T-10 | **Retention** | Garage Manager | Paper sheets are kept "until monthly ridership is closed out" (email). OPR-038's Required Records says the Garage Manager keeps them at the garage collection point "per MVTA records retention schedule". | Email (C6); OPR-038 Required Records | Partly: MVTA can ask for a past sheet |
| T-11 | **Handling** | Garage Manager | Sheets carry the Operator's name and ID. No handling rule beyond retention (H2). | Nowhere | No |
| T-12 | **Special events** | Contractor | Count sheets for special events go to MVTA Planning on paper, "unless otherwise completed digitally", with no rule for which (C7). | Email thread only | No |
| T-13 | **Training** | Contractor Training and Safety | OPR-038 makes Training and Safety responsible for initial and refresher training on **all** OPR-038 procedures, which includes ridership counting, and for keeping training records. Whether ridership is actually covered, and how, is **unknown**. | OPR-038, Responsibilities and Training | Yes: ask for the training content and records |
| T-14 | **Supervision and monitoring** | Garage Managers, contractor operations management | No ridership monitoring is described anywhere. Access has a *Find Records Not Yet Entered* menu item, but nothing says who uses it or how often. Missing sheets show up as blanks when Planning reviews the month. | Nowhere | No |

### 1.3 Measured against the contract clause

| Clause term | Today | Verdict |
|---|---|---|
| **"all trips"** | Nobody checks expected sheets against returned sheets (T-4). The photocopied sheet is the service change's roster, so it can't show a schedule fix made since (T-1). A blank in Access can mean not counted, did not operate or not keyed yet, and these can't be told apart. Trippers and extras have no roster row, so they can't be keyed at all. | **Not measurable.** The contractor can't show it counts all trips, and MVTA can't show it doesn't. |
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
of them, in particular the names of the desk and OCC staff who need OnBoard
accounts:

1. Who prints the service-change packet and keeps the master, and whether
   every Operator photocopies their own sheet at both garages.
2. When the Burnsville and Eagan check-in desks are staffed **in the evening**
   (the nightly print) and **before the first pull-out** (the morning
   reprint), and which printer each will use. This sets SOP decision 3.
3. What OCC types in the Access **Flag** field, and whether anyone uses
   *Find Records Not Yet Entered*. OnBoard has only *Not counted* and *Did
   not operate*, so any other use needs a home before December (spec §16).
4. How many OCC staff key ridership, on which shifts, and their names for
   OnBoard accounts.
5. Whether ridership counting is in the Operator training content, and the
   records.
6. Where paper sheets are kept now, how far back, and how they are destroyed.
7. Anything that changed in September 2026 that could explain D3.
8. Whether any Garage Manager has used the OPR-038 APC exception (C8).

---

## 2. The updated process, change by change

The OPR-038 amendment and OPR-RID-00 describe the stages by **MVTA's written
notice** rather than fixed dates (SOP decision record), so that the SOP stays
correct if a date slips. The dates below are the planned dates for those
notices.

### Change 1 — 2026-12-07 (the service change): OnBoard Count Sheets, scanned

**Audience: the incumbent contractor.** Decided 2026-11-03 (plan A): the new
sheets start on the **7 December 2026 service change**, not on 1 December, and
December is a **parallel run by scanning** rather than double keying.

- **1–6 December:** the current process continues (the packet, photocopied,
  keyed into Access).
- **No new packet is made for 7 December.** OnBoard's sheets replace it, so
  the photocopy habit ends on the day the schedule changes.

**What changes from 7 December:**

- **Each garage's check-in desk prints the next day's Count Sheets every
  evening** from OnBoard (Print sheets). The first live print is the evening
  of **6 December**, for 7 December.
  - The output is one PDF per garage, in pull-out order, with one sheet per
    block. Each sheet is dated and carries a QR code that links to that block
    and date.
  - Each trip is named by Avail's trip number (for example 320-E), with its
    direction and scheduled times in AM/PM.
  - Operator and bus are left blank.
  - Each trip row has digit boxes for the total and a **DNO** (did not
    operate) tick box.
  - The unscheduled-trip rows take a time, a circled direction, and a tick
    for Tripper, Extra or OCC.
  - A second operator line records a relief or bus change part way (#490).
  - Corner marks let a scan straighten the page.
- **The morning desk reprints** before the first pull-out. The Dispatch Log
  re-runs at 03:30 and marks any sheet it changed. The desk reprints those
  sheets with *Reprint just those N sheets*.
- **Photocopying stops.** A copied sheet carries the wrong date and QR code,
  so its counts would be filed under the wrong day.
- The desk staff who print hold the **Ridership Printer** role (#483).
- **The incumbent's OCC keys Access as today**, from the new sheet. Access
  stays the record. The incumbent's OCC does **not** key OnBoard and needs no
  OnBoard account.
- **Garage management scans each day's sheets** on the garage multifunction
  printer, one batch per garage, after OCC has keyed them.
  - Until OnBoard's upload page is live, each batch is saved to a shared
    folder MVTA names, and loaded into OnBoard later. So nothing waits on the
    upload build (#488).
  - Once upload is live, the batch goes straight into OnBoard.
- **OPR-038 is amended**: one boardings total per trip; the Garage Manager's
  APC exception is removed; the full procedure is OPR-RID-00.

**Precondition to check:** OnBoard writes 7 December's trips at 03:30 on
6 December, from the schedule it holds. The 7 December schedule must be
published and loaded into OnBoard before then, or the first night prints the
old schedule (A-7b).

| Who at the contractor | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operators** | Take the dated sheet from the desk with the paddle, and **no longer photocopy one**. Write name, Operator ID and bus. Record one boardings total per trip in the digit boxes, at the end of the trip, with the bus stopped. **Tick DNO** for a trip that did not run, and write 0 only for a trip that ran empty. Put unscheduled trips in the bottom rows, and use the relief or bus-change line if the block changes hands or buses. Write **Reconstructed** across the top of a rewritten sheet. Count on APC buses too | A short briefing at check-in or in a bulletin, with a filled-in example sheet. The count itself (one total per trip) is what they already do | The scans; reconstructed rate by garage and Operator |
| **Check-in desk / Garage Managers** (`Ridership Printer`) | **Evening:** print the next day's sheets, and act on the warning about blocks with no garage (*Unassigned*). **Morning, before the first pull-out:** reprint any sheet marked changed. Then issue the right sheet at check-in. Check each returned sheet (name, ID, bus, every row filled) before the Operator leaves. Chase missing sheets the same day | Hands-on: the evening print, the morning reprint, reprinting one block or any past date for a lost sheet, and what to do if OnBoard can't print (SOP decision 4) | OnBoard's print log, which records each sheet printed and reprinted, and any sheet changed but not reprinted |
| **Contractor OCC staff** | Key every sheet into Access as today, reading the new layout | A short briefing on the new sheet: where each trip's total, DNO, unscheduled trips and the relief line are | Access, as today |
| **Contractor operations management** | **Scan each day's sheets** after OCC has keyed them; save or upload each batch; keep the paper | Scanner and folder (later upload) routine at each garage | Sheets printed but never scanned, by garage and date |
| **Contractor Training and Safety** | Brief every Operator and desk person before 7 December; record it | Train-the-trainer from MVTA | Training records, on request |

### Change 2 — 7–31 December 2026: the parallel run by scanning

**Audience: the incumbent contractor, and Keolis's OCC in training.**

**What changes:**

- **Access remains the record for December.** The incumbent's only extra
  work is printing and scanning, not a second round of keying.
- **Keolis's OCC staff enter real scanned December sheets in OnBoard** as
  part of their December training (A-14). That gives them practice on real
  sheets before 1 January, and gives Planning OnBoard entries to compare.
- **MVTA Planning compares those entries with Access, trip by trip.** The
  Access TripID rule is known (day type + route + direction + start time, spec
  §16), so the match is mechanical. Not every sheet needs keying in OnBoard:
  Planning decides how many service dates are enough.
- The comparison of **7–15 December** is the basis for the conditional
  cutover notice on **18 December** (A-15).
- The deadline, flags and month close **do not apply** in December. OnBoard is
  not the entry system yet (OPR-RID-00, Transition step 7).
- **December's filled-in sheets and scans are also the handwriting sample**
  for the scan-reading trial (spec §15, #488). That is a second reason to
  keep every one of them and hand them over at contract end (A-17).

| Who | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Incumbent garage management** | Scan every sheet daily; keep the paper and hand it over by 2027-01-08 | As change 1 | Scans by garage and date; handover receipt |
| **Incumbent OCC** | Key Access as today | As change 1 | Access |
| **Keolis OCC staff** (`ridership-recorder`) | Key scanned December sheets in OnBoard during training | The OnBoard entry session, using the scans | Their entries against Access |
| **MVTA Planning** | Compare OnBoard entries with Access and recommend the cutover | — | The comparison |

**Risks particular to the incumbent:** December is the last month of its
contract, so staff turnover is likely. Its new work is small (print, issue,
scan), and Access being the record protects December's reporting whatever
happens. If scanning slips at a garage, the paper is still kept, and the
sheets can be scanned when the paper is handed over.

### Change 3 — 2027-01-01: Keolis takes over; OnBoard entry, flags and month complete

**Audience: Keolis.**

**What changes:**

- **OnBoard is the only record** (the Cutover Date), if MVTA accepts
  December's comparison (decision O-4). The Access data-entry form is
  retired, and Keolis never keys Access.
- **The desks, Operators and scanning carry on** exactly as in change 1, now
  done by Keolis staff.
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
| **Check-in desk / Garage Managers** (`Ridership Printer`) | As change 1 | Printing and issue, hands-on, before 2027-01-01 | Print log; missing sheets by garage |
| **OCC staff** (`ridership-recorder`) | Enter every sheet in OnBoard by the deadline; override operator or bus to match the sheet; add unscheduled trips; tick Reconstructed; review completeness daily; answer every flag from the paper; mark the month complete by the 5th | OnBoard entry in December, on the scanned sheets; flags and month complete in the first week of January | Entry timestamps; late sheets; overrides; flag answers; the month-complete date |
| **Operations management** | Scan each day's sheets; weekly completeness review; corrective action on repeat failures; access requests and removals the day someone leaves | Scanner routine; completeness view walk-through | Scans by garage; review notes; access removals on time |
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
- **Decided 2026-11-02** (SOP 03, decision O-1): reporting failures follow
  **Attachment G's own Transition and Ramp-Up Periods**, counted from the
  Cutover Date (2027-01-01):
  - **Months 1–3 (January–March 2027):** the Transition Period. Occurrence
    penalties are suspended for non-safety measures, so candidates are
    raised, confirmed and reported, but not charged.
  - **Months 4–6 (April–June 2027):** the Ramp-Up Period, charged at 50%
    ($250 per sheet).
  - **From July 2027:** charged in full, $500 per sheet.
- So the first charged month is **April 2027**, closed by 2027-05-10.
  April is also when the kiosk pilot can start at the earliest. Expect
  Keolis to ask for the pilot garage to be treated gently, and decide that
  before the pilot (O-13).

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
- **The submission becomes the record. The paper still comes back** (spec
  §15; #458 decision 20, changed 2026-10-31).
  - Every sheet, submitted or not, goes to the contractor's operations
    management at the garage.
  - Operations management **batch-scans the day's sheets** on the garage
    multifunction printer.
  - OnBoard compares each scan with the submission and raises a flag where
    they differ. Where a run was not submitted, OnBoard pre-fills OCC's form
    from the scan for OCC to confirm.
  - Scans are kept under MVTA's retention schedule, so once scanning starts,
    keeping the paper probably stops being the contractor's job. That depends
    on the retention period, which is still open.
- **Scan-and-upload entry** is a possible third method: the desk scans
  sheets up to three times a day and uploads them to OnBoard. It is still
  open (SOP decision 19), and a session is building it now. If it lands
  before the kiosk, the scanning duty above reaches Keolis earlier.
- **The kiosk is an operator platform,** not only a ridership device. Other
  modules (vehicle condition reports, detour information) follow on the same
  sign-in (#461).
- **Phones** only after MVTA consults the contractor and amends OPR-038, which
  bans personal devices on duty. Phone use is voluntary; the kiosk stays the
  fallback.

| Who at Keolis | Must do | Training needed | Evidence MVTA will look at |
|---|---|---|---|
| **Operators** | Sign in, choose the run, key the totals, submit at pull-in | A short hands-on session at the kiosk | Count source (kiosk / phone / OCC from paper / OCC from draft) by garage |
| **Check-in desk** (`operator-credential-admin`, name pending) | Issue one-time PINs, reset locked PINs, **disable a PIN the day an Operator leaves** | PIN issue and reset | PINs disabled on time |
| **Operations management** | Agree the work rules: kiosk time at pull-in is paid time; phone use is voluntary. **Scan each day's sheets** at each garage | A negotiation for the work rules; a short session on the scanner and upload route | A written agreement before the pilot; sheets expected but never scanned, by garage |
| **OCC staff** | Submitted runs drop off the worklist; OCC submits saved drafts operators left; answers flags as before | Draft submission | Count source; drafts submitted by OCC |

---

## 3. Proposed actions

MVTA owners are roles, not names. "Operations" is MVTA Operations under the
COO; "Contracts" is whoever administers the operations contracts.

Dates use the 14-day notice period (decided, #486). Note
Thanksgiving falls on **2026-11-26**.

| # | Action | Audience | Owner at MVTA | By when | Artifact |
|---|---|---|---|---|---|
| A-1 | Settle the SOP's **[Decide]** items still open before issue: whose staff the OCC are (6), the Attachment G route (7), what "accepts the Parallel Run" means (15), who gives the notices (16), the contract number (13), the SOP code (1), and scan-and-upload entry (19). Notice, printing, the print fallback and the desk-to-OCC frequency are already decided (#486) | Internal | Operations + Planning | 2026-11-06 | Decision note on the SOP draft |
| A-1a | ~~Update the SOP drafts with the decided print process~~ **Done in #486** (merged): evening print, morning reprint, Ridership printer role, no photocopies, DNO tick box. Left: check that the Word versions in `ridership/` match before they go out | Internal | Planning + Operations | 2026-11-11 (before A-5) | Revised OPR-RID-00 and OPR-038 redline |
| A-2 | Fact-finding meeting with the incumbent's operations and OCC leads: the eight questions in §1.6 | Incumbent | Operations | 2026-11-09 | Meeting, with notes |
| A-3 | Confirm with Contracts whether ridership reporting failures fall under `INCIDENT_REPORTING` as written in **both** contracts, and whether the December printing and scanning are within the incumbent's scope (decisions O-3, O-5) | Both | Contracts | 2026-11-10 | Written opinion |
| A-4 | **Transition and kick-off meeting with Keolis** on ridership: today's process, the December run by scanning (and Keolis's OCC keying the scans in training), the rules from 2027-01-01, the occurrence start, the kiosk later. Use §4's talking points | Keolis | COO, with Planning and Compliance | 2026-11-13 | Meeting, with talking points and the SOP drafts as read-ahead |
| A-5 | **Formal notice to the incumbent**: the amended OPR-038 and OPR-RID-00; the Parallel Run starting on the **7 December** service change (OnBoard sheets printed by the desks, keyed into Access as today, scanned daily by garage management); no new packet for 7 December; Access remaining the record; nothing assessed in December; and the paper handover at contract end | Incumbent | COO | 2026-11-13 recommended; **2026-11-23 at the latest** (14 days before 12-07) | Letter, with OPR-038 redline and OPR-RID-00 |
| A-6 | **Formal notice to Keolis**: the amended OPR-038 and OPR-RID-00 as MVTA's procedure under the contract clause, effective for Keolis from 2027-01-01, with the planned Cutover Date and the compliance start and grace period (decision O-1) | Keolis | COO | 2026-11-20 | Letter, with OPR-038 redline, OPR-RID-00 and a sign-off copy (the SOP's Contractor Representative row) |
| A-7 | Collect named staff. From the **incumbent**: the check-in desk staff at Burnsville and Eagan who will print in the evening and reprint in the morning. Its OCC needs no OnBoard account. From **Keolis**: OCC staff and check-in desk staff | Both | Operations | Incumbent 2026-11-13; Keolis 2026-12-04 | Email request with a fixed template (name, work email, role, garage, shift) |
| A-7a | **Enter the block-to-garage list on prod**, first for the current schedule (for the rehearsal), then for the **7 December service change**. The list is empty today. Use the bulk assign on Ridership setup. A list inferred from where buses park overnight is a ready starting point (on v64: Eagan 160 blocks, Burnsville 20). Check every block for both garages: an unassigned block prints under *Unassigned*, which no desk owns | Internal | Planning | Current schedule 2026-11-16; 7 December blocks by **2026-12-04** | OnBoard Ridership setup |
| A-7b | **Load the 7 December schedule into OnBoard ahead of time.** Confirm the date the GTFS for the service change is published, and that OnBoard's Dispatch Log has 7 December's trips by 03:30 on 6 December. Check on the 6th before the evening print | Internal | Planning + Engineering | Date confirmed 2026-11-13; checked 2026-12-06 | The Dispatch Log for 2026-12-07 |
| A-7c | **Scanning route at each garage**: the multifunction printer scans a batch PDF to a shared folder MVTA names, with access limited to the ridership roles (the scans carry Operator names). Then build OnBoard's capture page (upload, split by QR code, store) per #488, and load the folder's batches into it once it is live | Internal | MVTA IT (route and folder); Engineering (capture page) | Route by **2026-12-04**; capture page as soon as built | Shared folder; OnBoard upload |
| A-8 | **OnBoard access, as numbered steps:** (1) migrations 153, 154, 157, 159, 161 and 162 are **already applied on prod**. (2) MVTA IT creates **Entra B2B guest accounts** (Guest Sponsorship) on prod for the names from A-7. (3) An access administrator assigns **Ridership Printer** to each check-in desk person (incumbent, then Keolis). (4) Assigns **`ridership-recorder`** to each **Keolis** OCC person. The incumbent's OCC needs none under plan A. (5) Assigns **`ridership-manager`** to the named Planning staff. (6) Each person signs in at onboard.mvta.com and confirms they see their tab: Print sheets, or Enter sheets | Both | MVTA IT + an access administrator | Incumbent desks **2026-11-16** (before the print rehearsal); Keolis **2026-12-11** | OnBoard access |
| A-8a | **Print rehearsal at both garages**: each desk prints a real next-day stack (not issued), tries the morning reprint, scans a QR code with a phone, and checks the Unassigned warning. Garage management scans the stack to the folder as a test | Incumbent | Operations + Planning | Week of 2026-11-16 | Rehearsal, with a short checklist |
| A-9 | **Briefing for the incumbent's OCC on the new sheet layout**, for keying Access from it: where each trip's total, DNO, unscheduled trips and the relief or bus-change line are | Incumbent | Planning | 2026-11-30 | 30-minute briefing with an example sheet |
| A-10 | **Dress rehearsal and go/no-go**: (a) each garage prints the next day's stack on the night of 2026-11-29, checks it against the pull-out list and **does not issue it**; (b) the morning desk on 11-30 runs the reprint check; (c) garage management scans the stack; (d) go/no-go for 7 December | Incumbent | Planning + Operations | (a)–(c) 11-29/30; (d) go/no-go **2026-12-04** | Dress rehearsal, with a go/no-go checklist |
| A-11 | Train the incumbent's check-in desks (evening and morning shifts) and garage management: the evening print, the morning reprint, issue with the paddle, the returned-sheet check, the print fallback, and the daily scan | Incumbent | Operations | 2026-11-20 (with A-8a) | Training session at each garage |
| A-12 | Operator briefing on the new sheet from 7 December: **stop photocopying**, take the dated sheet from the desk, the digit boxes, the DNO tick box, the unscheduled rows, the relief or bus-change line, Reconstructed, name/ID/bus, and no writing while moving | Incumbent | Operations, through the contractor's Training and Safety | 2026-12-04 | Operational Bulletin with an example sheet |
| A-13 | Weekly December check-in with the incumbent: sheets printed, returned and scanned by garage; anything the desks or Operators found hard | Incumbent | Planning | Each Friday from 2026-12-11 | Meeting (30 min) |
| A-14 | Keolis training: **OCC on OnBoard entry, keying real scanned December sheets** (this is the comparison data for A-15); check-in desks on the evening print and morning reprint; garage management on the daily scan; Operators on counting in their transition training; Training and Safety train-the-trainer | Keolis | Planning (OCC), Operations (desks, Operators) | OCC keying 2026-12-09 → 12-18; the rest by 2026-12-18 | Training sessions on prod with real scanned sheets; quick guides |
| A-15 | **Cutover notice**: OnBoard is the only record from 2027-01-01, based on Planning's comparison of Keolis's OnBoard entries from the 7–15 December scans with Access (decision O-4) | Both | COO, on Planning's recommendation | 2026-12-18 | Letter |
| A-16 | Keolis OCC training on flags and month complete, once they ship | Keolis | Planning | 2027-01-08 | Training session |
| A-17 | Paper handover: the incumbent delivers every Count Sheet not yet released (at least November and December) to MVTA Planning, filed by garage and date, and confirms every December batch is in the scan folder. December's sheets are also the handwriting sample for the scan-reading trial (spec §15, #488) | Incumbent | Planning | 2027-01-08 | Letter (in A-5); signed handover receipt |
| A-18 | Remove the incumbent's guest accounts and their Ridership Printer grants | Incumbent | MVTA IT + an access administrator | 2027-01-01 | OnBoard access |
| A-19 | Transition Period (January–March 2027): confirm each month's candidates and report them to Keolis, with no charge | Keolis | Compliance manager | 2027-02-12, 03-12, 04-12 | The monthly assessment, with ridership shown and not charged |
| A-20 | First charged month (April 2027, at 50% in the Ramp-Up Period) closed and candidates confirmed | Keolis | Compliance manager | 2027-05-12 | Contractor Performance Assessment |
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

5. The new Count Sheets start on the 7 December service change, under the
   incumbent, so by 1 January your desks inherit a routine that is already
   running. They print the next day's sheets from OnBoard every evening, one
   per block and dated, and reprint any that change before the morning
   pull-out. No photocopies: a copied sheet carries the wrong date. Your
   garage management scans each day's sheets.
6. Operators write their name, ID and bus, then one boardings total per trip,
   at the end of the trip, with the bus stopped. Tick DNO if a trip did not
   run. Write 0 only for a trip that ran empty.
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
12. Attachment G's Transition and Ramp-Up Periods apply. January to March
    2027 are reported to you but not charged. April to June are charged at
    half ($250 a sheet). Full charges start in July 2027.

**What we need from you, and when**

13. Names of the OCC staff who will enter sheets, and of the check-in desk
    staff who will print, by **2026-12-04**, so we can create their OnBoard
    accounts by 2026-12-11.
14. Time in your transition training for ridership: OCC and desks by
    2026-12-18; Operators in their onboarding.
15. A named lead at Keolis for ridership, who attends the monthly
    performance meeting.
16. Your OCC staff available from about 9 December, to key real scanned
    December sheets in OnBoard as their training. Their entries are what we
    compare with Access before we confirm OnBoard as the record from
    1 January.

**What's coming later**

17. A garage kiosk where Operators enter their own counts at pull-in, piloted
    at one garage no earlier than spring 2027. We will agree the work rules
    with you first. The paper still comes back, and your garage management
    scans each day's sheets on the garage's multifunction printer, so OnBoard can check the
    two against each other.
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
| **O-1** | ~~Compliance start date and grace period~~ **Decided 2026-11-02 (#486):** from the Cutover Date, under Attachment G's Transition Period (months 1–3, not charged) and Ramp-Up Period (months 4–6, 50%) | — | Gives a longer start than the one-month grace first recommended here, and needs no special rule for ridership. State it in the Keolis notice (A-6). |
| O-2 | Accept the per-sheet exposure | Keep one occurrence per sheet as agreed, but **check it with Contracts before A-6**, and consider whether a day's systemic failure (OnBoard down, a whole garage late) should be treated as one occurrence. | 144 sheets a weekday at $500 each makes one bad day large. Better settled before the notice than in the first dispute. |
| O-3 | Does `INCIDENT_REPORTING` cover ridership reporting failures as written, in **Keolis's** Attachment G? (SOP decision 7, gap C4) | Ask Contracts (A-3). If it does not, the occurrence stage waits for an amendment, and the rest goes ahead. | Without it, change 4 has no legal basis. |
| O-4 | ~~Cutover before December has closed~~ **Decided 2026-11-02 (#486)**, and shaped by plan A (2026-11-03): the cutover notice rests on Keolis's OnBoard entries of the 7–15 December scans against Access. The incumbent keys Access through 31 December | Issue the conditional cutover notice on **2026-12-18** (A-15). | Keolis never keys Access. Access stays available as a fallback until December is accepted. |
| O-5 | ~~December double keying in the incumbent's scope~~ **Removed by plan A (2026-11-03):** the incumbent no longer double keys. Its new work is printing and daily scanning, which still needs agreeing in A-5 | Raise printing and scanning at A-2, and agree them in A-5. | Small new work in the last month of a contract, best agreed rather than assumed. |
| O-6 | ~~Keolis OCC shadowing in December~~ **Replaced by plan A (2026-11-03):** Keolis's OCC keys real scanned December sheets in OnBoard during training (A-14) | Ask at kick-off when Keolis's OCC staff are available, and whether 12-09 → 12-18 works. | Real practice for Keolis, comparison data for MVTA, and no extra load on the incumbent. |
| O-7 | ~~Notice period~~ **Decided 2026-11-02 (#486): 14 calendar days.** | — | The incumbent's notice must go by 2026-11-17; A-5 sends it on 11-13. |
| O-8 | ~~Who prints sheets~~ **Decided 2026-11-02:** each garage's check-in desk prints in the evening and reprints in the morning, under the Ridership Printer role (#483) | — | — |
| O-9 | Paper sheets from the incumbent at contract end | Handover to MVTA Planning by **2027-01-08** (A-17). MVTA then holds them until each month is released. | Nobody at the incumbent is left to keep them, and they carry Operator names and IDs (H2). |
| O-10 | Special events (C7) | Tell both contractors that today's practice continues unchanged, outside OPR-RID-00, until MVTA writes a rule. | Keeps C7 out of the occurrence rule until it has one. |
| O-11 | When a garage's desk isn't staffed in the evening (SOP decision 3) | The last desk shift of the day prints. Where there is none, the morning desk prints the whole stack before the first pull-out. Tomorrow's sheets exist from 03:30 the day before. | It keeps one rule, "printed before the Operator arrives", whatever each garage's staffing turns out to be (§1.6 question 2). |
| O-12 | Tell Keolis now about the scanning duty that comes with the kiosk (spec §15)? | Yes. Mention it at kick-off as coming (talking point 17), and put it in the work-rules consultation (A-22). | It is new daily work for Keolis's garage management. Hearing it in spring would look like scope creep. |
| O-13 | The kiosk pilot garage in the first charged month | Start the pilot no earlier than April 2027 as planned. Pilot-garage sheets are excused only where the kiosk itself fails, with the paper as fallback. Write this into the pilot agreement (A-22). | The pilot and the first charged month (April, Ramp-Up) coincide. A failed submission caused by a new device shouldn't become a $250 occurrence, but an ordinary late sheet should. |

Decisions already open elsewhere, which this briefing does not reopen: the
remaining SOP [Decide] items (`plans/sop-drafts/03-decisions-before-issue.md`);
the December sign-off tolerance (R6, PR #459); ServiceType (Q15).
