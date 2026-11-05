# Ridership Counting and Reporting (DRAFT)

**Status:** draft for MVTA Planning and Operations, 2026-11-04. Written in the
layout of the MVTA SOP source template (v1.1.2) used by OPR-038-00, from the
decisions in `plans/ridership-counting-spec.md` and
`03-decisions-before-issue.md`. The document code is a placeholder until MVTA
registers it.

| Field | Value |
|---|---|
| Document type | SOP — Standard Operating Procedure |
| Document title | Ridership Counting and Reporting |
| Category code | OPR |
| Department | Operations |
| Author | |
| Author role | |
| Distribution | External |
| Existing document ID | OPR-RID-00 (to be registered; this is its first issue, Revision 00) |
| Related documents | OPR-038-00, OPR-061-00, OPR-123-00 |
| Figures | None |

## Scope

This Standard Operating Procedure sets out how ridership is counted, recorded,
checked and reported for MVTA fixed-route bus service, from the printing of a
Count Sheet to MVTA's close of the month's counts, and how ridership moves
from MVTA's Access database to OnBoard.

This SOP applies to every MVTA fixed-route revenue trip, scheduled or added,
and to the personnel who count, collect, enter and review ridership: Bus
Operators, check-in desk staff and Garage Managers, Contractor OCC staff,
Contractor Operations Management, Contractor Training and Safety staff, MVTA
Planning, MVTA Operations and MVTA Compliance.

The General Bus Operations SOP (OPR-038-00) summarizes the Operator's part of
this procedure and cites this document by code. Other SOPs must cite this
document, OPR-RID-00, rather than restate it.

This SOP does not govern deadhead movements, which carry no passengers;
MVTA Connect ridership, which is taken from the on-demand scheduling system and
is not counted by Operators; or special-event counts, which are covered
separately.

## Purpose

MVTA uses ridership counts to plan service, to report performance and to
apply for funding, including its reporting to the National Transit Database.
A count that is missing, late or wrong carries into each of
those.

The operations contract requires Operators to conduct passenger counts on all
trips in accordance with MVTA's procedures and standards, and to record them
accurately and in a timely manner. It makes the Contractor responsible for
training, supervising and monitoring its employees, and for ensuring that
MVTA's ridership counting and reporting procedures are implemented and
consistently followed. This SOP is that procedure. It gives each of the
contract's terms a measurable standard: **all trips** means a count for every
trip that operated; **timely** means entered by the end of the calendar day
after the service date; and **accurately** means every question
MVTA raises about a count is answered from the sheet before the month closes.

## Definitions

The following terms are used throughout this document.

| Term | Definition |
|---|---|
| Access Database | The Microsoft Access database in which MVTA's ridership is recorded until the Cutover Date. |
| APC (Automatic Passenger Counter) | Onboard equipment that counts passengers boarding and alighting at each stop. |
| Block | A scheduled sequence of trips assigned to a vehicle during a service day. At MVTA a block is one Operator's assignment. |
| Block-to-Garage List | The list, kept by MVTA Planning in OnBoard, of which garage operates each block in the current service change. |
| Count | The number of passengers who boarded on one trip. |
| Contractor | The operations contractor MVTA engages for fixed-route service at the time. |
| Count Sheet | The sheet for one block on one service date on which the Operator records the Count for each trip. From the start of the Parallel Run it is printed from OnBoard. |
| Cutover Date | The first service date on which OnBoard is the only record of ridership, set by MVTA in writing. |
| Flag | A question about a Count that OnBoard or MVTA Planning raises because the Count looks unusual. A Flag is a question, not a finding. |
| Missed Trip | A scheduled trip that is not operated as planned. |
| Month Close | MVTA Planning's acceptance of a month's Counts as final for reporting. |
| Month Complete | The Contractor's declaration in OnBoard that every Count Sheet for a month is entered and every Flag answered. |
| OnBoard | MVTA's operations console, the system of record for ridership Counts from the Cutover Date. |
| Parallel Run | The period before the Cutover Date in which Count Sheets are printed from OnBoard, keyed into the Access Database, which remains the record, and scanned, so that MVTA can compare entries made in OnBoard from the scans with the Access Database. |
| Reconstructed Count Sheet | A Count Sheet the Operator rewrites from memory after the original was lost or damaged during service. |
| Reporting Failure | A Count Sheet that is missing, entered late, or carries a Flag unanswered at Month Close. |
| Service Date | The operating day a trip belongs to, in Central time. A trip after midnight belongs to the service date on which its block began. |
| Unscheduled Trip | A revenue trip that operated but is not printed on the Count Sheet, such as extra service, a tripper or a trip the OCC directs. |

## Responsibilities

Ridership counting is a chain: a count is only as good as the sheet it was
written on, and a sheet is only useful once it is entered and checked. The
table sets out each role's link in that chain.

| Role | Responsibilities |
|---|---|
| Bus Operators | Count every boarding passenger on every trip of the assigned block, record each trip's Count on the Count Sheet, and hand the sheet in at pull-in. |
| Check-In Desk Staff and Garage Managers (OnBoard role: Ridership printer) | Print the next service date's Count Sheets from OnBoard each evening, reprint changed sheets each morning, issue each Operator the sheet for the assigned block, collect completed sheets at pull-in, follow up the same day on any sheet not returned, pass sheets to Contractor OCC staff, and store sheets as this SOP requires. |
| Contractor OCC Staff (OnBoard role: Ridership recorder) | Enter every Count Sheet by the deadline: in the Access Database until the Cutover Date and in OnBoard from it. Add Unscheduled Trips, review completeness daily, answer every Flag, and mark each month complete. |
| Contractor Operations Management | Supervise and monitor compliance with this SOP: review completeness and timeliness in OnBoard, correct repeated Operator or staff failures, request and remove OnBoard access for Contractor staff, scan each day's Count Sheets during the Parallel Run and whenever MVTA enables scan and upload, and keep the paper Count Sheets for the required period. |
| Contractor Training and Safety Staff | Train every Operator, check-in desk staff member and OCC staff member on this SOP before they perform it, and keep the training records. |
| MVTA Planning (OnBoard role: Ridership manager) | Maintain the Block-to-Garage List and the Flag settings, review Counts, raise Flags, close each month and reopen a closed month when a correction is needed. During the Parallel Run, compare the OnBoard entries made from scans with the Access Database and recommend whether OnBoard is ready. |
| MVTA Operations | Give the Contractor written notice of each transition stage and the Cutover Date, and issue any written authorization that lets APC replace the Count Sheet. |
| MVTA Compliance | Review each Reporting Failure OnBoard proposes at Month Close and confirm or dismiss it before it is assessed. |

## Procedures

The procedures below follow a Count Sheet from printing to Month Close. Each
opens by naming the role that carries it out.

### Block-to-Garage List

**Carried out by:** MVTA Planning.

OnBoard reports completeness by garage, so it must know which garage operates
each block. MVTA Planning sets this up once for each service change.

1. Before each service change takes effect, enter or update the
   Block-to-Garage List in OnBoard for the new service change.
2. Review the completeness view after the first service date of the change.
   A block shown as **Unassigned** has no garage on the list; add it.

NOTE: A block with no garage is still counted and still required. It appears
as Unassigned so the gap is visible rather than silent.

### Count Sheet Printing and Issue

**Carried out by:** check-in desk staff, under the Garage Manager.

Every Operator needs the right sheet before the first trip. OnBoard prepares
each service date's sheets the day before, from the scheduled trips: one sheet
per block, listing each revenue trip's route, direction, scheduled times and
Avail trip number, with a QR code that ties the sheet to its block, service
date and page. The Operator name and bus are left blank, because Operators are
assigned just before pull-out. OnBoard refreshes the schedule early each
morning and marks any sheet whose trips changed after it was printed.

1. Each evening, open **Ridership**, then **Print sheets**, choose your garage
   and print the next service date's Count Sheets. OnBoard produces one file
   per garage, in pull-out order. Where the desk is not staffed every evening,
   it may print up to three service dates ahead, for example Saturday through
   Monday on Friday evening; keep each date's sheets apart, and step 3 still
   applies every morning.
2. Check the print page for blocks shown as Unassigned or dropped. Tell MVTA
   Planning the same evening about any Unassigned block your garage operates,
   and print its sheet with your garage's.
3. Each morning before the first pull-out, open **Print sheets** again and
   reprint every sheet OnBoard marks as changed. Discard the earlier copy of
   each reprinted sheet.
4. At check-in, give each Operator the Count Sheet for the assigned block and
   service date with the run paperwork (OPR-038-00, Operator Check-In and
   Check-Out).
5. If OnBoard is unavailable and sheets cannot be printed, notify Contractor
   Operations Management and the IT Service Desk, and issue blank Count
   Sheets on which the Operator writes the block, service date and each trip.

REQUIREMENT: Do not photocopy a Count Sheet or reuse one from another day.
Each sheet is printed for one block on one service date, and its code files
the counts under that block and date.

### Counting on the Trip

**Carried out by:** Bus Operators.

The Count is the number of passengers who boarded the trip. One total per trip
is recorded; alightings and counts by timepoint are not.

1. Before your first trip, write your name, Operator ID and bus number on the
   Count Sheet. If you change buses during the block, write the new bus number
   beside the first trip operated on it.
2. Count every passenger who boards on every trip printed on the sheet,
   including passengers who board with a pass, a transfer or no fare. A
   passenger who stays aboard from one trip into the next has not boarded
   the next trip and is not counted again.
3. Make one stroke in the trip's **Tally** box for every boarding. At the
   end of the trip, write the total in the **Total boardings** boxes, one
   digit per box (for 27 riders, write 0 2 7). If no one boarded, write 0.
4. Record actual observations only. Do not estimate or round.
5. If you operate a trip that is not on your sheet, write its route,
   direction, start time and boardings in the **Unscheduled trips** rows at
   the bottom of the sheet.
6. If a trip on your sheet did not operate, tick its **DNO** box and leave
   the total blank. Do not write 0.
7. Complete the Count Sheet on every trip, including on a bus with APC
   equipment, unless MVTA has authorized otherwise in writing (Automatic
   Passenger Counters, below).

REQUIREMENT: Do not write on the Count Sheet while the vehicle is moving.
Record each trip's total at the end of the trip, when the vehicle is stopped.

### Lost or Damaged Count Sheets

**Carried out by:** Bus Operators.

1. If your Count Sheet is lost or damaged during service, keep counting.
   Write each remaining trip's total on any paper you have, at the end of the
   trip, and notify the OCC and the Garage Manager at pull-in.
2. Reconstruct the counts as accurately as you can on a new Count Sheet for
   the same block and service date, reprinted by the check-in desk, and tick
   its **Reconstructed** box.
3. Hand in the Reconstructed Count Sheet, and the damaged original if you
   still have it, at pull-in.

NOTE: A Reconstructed Count Sheet entered on time is not a Reporting Failure.
OnBoard reports how often sheets are reconstructed, by garage and Operator,
so that repeated losses can be addressed.

### Pull-In and Sheet Collection

**Carried out by:** check-in desk staff, under the Garage Manager.

1. At pull-in, the Operator hands the completed Count Sheet to the check-in
   desk as part of check-out (OPR-038-00, Pull-In and End-of-Shift
   Procedures).
2. Check the sheet before the Operator leaves: name, Operator ID and bus
   number are filled in, and every trip row has a total or a ticked DNO box.
3. By the end of the shift, confirm that a sheet has come back for every block
   that operated. Follow up the same day with the Operator of any block whose
   sheet is missing.
4. Pass completed sheets to Contractor OCC staff for entry up to three
   times a day, and keep entered sheets together by service date and garage.

NOTE: When MVTA enables other ways of entering a sheet, the timing follows
the method: an Operator who enters counts directly enters them at the end of
the shift, and sheets scanned and uploaded to OnBoard are uploaded up to
three times a day. The paper sheet is still handed in at pull-in.

REQUIREMENT: A Count Sheet must not be altered after it is handed in. A
correction is made in OnBoard, where it is recorded, never on the paper sheet.

### Entering Count Sheets in OnBoard

**Carried out by:** Contractor OCC staff.

Contractor OCC staff enter each sheet exactly as written. OnBoard opens on a
worklist of the sheets still to enter, with completeness by garage at the top
and the late sheets first.

1. In OnBoard, open **Ridership**, then **Enter sheets**, and choose the sheet
   from the worklist, or choose the service date and block.
2. Check the Operator name, Operator ID and bus that OnBoard shows. OnBoard
   takes them from the Operator's login on the bus. If the sheet shows a
   different Operator or bus, change OnBoard to match the sheet. The sheet
   wins.
3. Enter each trip's Count from the sheet, in order.
4. For a trip with DNO ticked, record it as Did not operate. A trip
   that MVTA has confirmed as a Missed Trip does not need a Count.
5. Add each Unscheduled Trip written on the sheet with **Add trip**, giving
   its route, direction, start time and the reason it was added, and enter
   its Count.
6. If the sheet is marked Reconstructed, tick **Reconstructed**.
7. Save the sheet. OnBoard records who entered it and when, and opens the
   next sheet on the worklist.

REQUIREMENT: Every Count Sheet must be entered in OnBoard by the end of the
calendar day after its service date, Central time. A sheet for Monday's
service is due by 11:59 p.m. on Tuesday.

### Monitoring Completeness and Timeliness

**Carried out by:** Contractor OCC staff and Contractor Operations
Management.

Completeness is a count for every trip that operated. OnBoard compares the
Counts entered with the trips that were scheduled and lists the trips that
still need a Count, and the sheets entered late, by garage and service date.

1. Contractor OCC staff review the completeness view at least once each day
   and enter or chase every outstanding sheet.
2. Contractor Operations Management reviews completeness and timeliness at
   least once a week, by garage and Operator, and acts on repeated missing,
   late or Reconstructed sheets through the Contractor's performance
   management process.
3. A trip whose operation OnBoard cannot confirm still needs a Count. Only a
   trip that MVTA has confirmed as missed or canceled is excused.

### Answering Flags

**Carried out by:** Contractor OCC staff. MVTA Planning raises Flags.

MVTA checks every Count against the same trip's recent history. OnBoard raises
a Flag on a Count that is far above the same trip's usual Count, or zero when
the trip usually carries passengers. MVTA Planning may also flag any Count.

1. OnBoard compares each trip's Count with the same trip (route, direction,
   scheduled start and day type) over the previous four weeks, and flags a
   Count outside the thresholds MVTA Planning sets in OnBoard.
2. Contractor OCC staff open each Flag under **Ridership**, **Flags**, and
   check the Count against the paper sheet.
3. If the Count was entered wrongly, **correct** it to match the sheet.
4. If the Count matches the sheet, **confirm** it, with a short note giving
   any reason known (for example, a school group or an event).
5. Answer every Flag for a month by the **5th** of the following month. A
   Flag MVTA Planning raises after the 5th is answered within one business
   day.

NOTE: At issue, OnBoard flags a Count that is more than three times the
four-week median and at least 10 above it, or zero when the median is 5 or
more. MVTA Planning may change these thresholds and tells the Contractor when
it does.

NOTE: Confirming a Flag is not an admission of error. A Flag asks the
Contractor to check the sheet; a confirmed Count stands.

### Month Close

**Carried out by:** Contractor OCC staff, then MVTA Planning.

1. By the **5th** of the following month, once every sheet is entered and
   every Flag answered, Contractor OCC staff mark the month **complete** in
   OnBoard.
2. By the **10th** of the following month, MVTA Planning reviews the month and
   **closes** it in OnBoard. The closed month is the record from which MVTA
   reports ridership.
3. After Month Close a Count can be changed only if MVTA Planning reopens the
   month and gives a reason. OnBoard records every change to a closed month,
   with the previous and new values, who made it and why.

### Reporting Failures

**Carried out by:** MVTA Compliance.

1. At Month Close, OnBoard proposes a Reporting Failure for each Count Sheet
   (one block on one service date) that is:
   - **missing**: a block that operated still has no sheet entered at Month
     Close;
   - **late**: entered after the end of the calendar day after the service
     date; or
   - **unanswered**: carries a Flag still unanswered at Month Close.

   A sheet counts once, however many of these apply.
2. MVTA Compliance reviews each proposed Reporting Failure with its evidence
   and confirms or dismisses it.
3. Each confirmed Reporting Failure is assessed under the Incident and Data
   Reporting standard of Attachment G.

REQUIREMENT: Missing, late and unanswered Count Sheets may result in penalties
and corrective action under Attachment G. A Reconstructed Count Sheet entered
on time is not a Reporting Failure.

### Count Sheet Retention and Handling

**Carried out by:** Contractor Operations Management.

Count Sheets are the evidence for the Counts and for any Reporting Failure, and
they carry Operator names and IDs.

1. Keep every paper Count Sheet, filed by garage and service date, until
   MVTA confirms that the month's performance assessment is final and its
   dispute period has passed.
2. Produce any Count Sheet MVTA requests within one business day.
3. Store Count Sheets securely. Do not share them, or the Operator names and
   IDs on them, outside the Contractor and MVTA.
4. When MVTA confirms a month, destroy its Count Sheets securely.

NOTE: OnBoard shows Operator names only to the Ridership recorder and
Ridership manager roles and to MVTA Compliance. Other OnBoard users and
exports see Counts without names.

### Automatic Passenger Counters

**Carried out by:** Bus Operators. MVTA Operations authorizes any exception.

Some MVTA buses carry APC equipment. Until APC Counts have been shown to agree
with manual Counts, the Count Sheet remains the record on every trip.

1. Complete the Count Sheet on every trip, whether or not the bus has APC.
2. Verify at pull-out that the APC equipment is active, as part of the
   pre-trip inspection (OPR-038-00, Pre-Trip Inspection Requirement). Report a
   faulty counter as an in-vehicle technology issue.
3. MVTA may authorize in writing that a bus or route no longer needs a Count
   Sheet, once its APC Counts meet criteria MVTA sets. Until MVTA
   does so, no one else may excuse a Count Sheet because APC is installed.

### Transition from the Access Database

**Carried out by:** all roles, on MVTA Operations' written notice.

Until OnBoard takes over, the current process continues. Operators complete a
Count Sheet with one total per trip, check-in desk staff collect the sheets,
and Contractor OCC staff key them into MVTA's Microsoft Access ridership
database, which is the record. MVTA moves ridership to OnBoard in three
stages. MVTA sets the start of each stage and gives the Contractor written
notice at least 14 calendar days in advance.

| Stage | Begins | Count Sheet | Entered in | Record |
|---|---|---|---|---|
| Current process | In effect now | Current sheet | Access | Access |
| Parallel Run | A service date MVTA sets, normally the first day of a service change | OnBoard sheet, scanned | Access by Contractor OCC staff; OnBoard from the scans, by staff MVTA designates | Access |
| OnBoard only | The Cutover Date | OnBoard sheet | OnBoard | OnBoard |

1. Until the Parallel Run begins, follow the current process. The Access
   database is the record.
2. During the Parallel Run, print and issue Count Sheets from OnBoard as set
   out in Count Sheet Printing and Issue. Do not photocopy or reuse the
   previous packet. Contractor OCC staff key every sheet into the Access
   database as before, which remains the record. They do not also enter it
   in OnBoard unless MVTA directs it.
3. Each day of the Parallel Run, Contractor Operations Management scans the
   previous day's completed sheets on the garage multifunction printer, as
   one batch per garage, after OCC has keyed them, and uploads the batch to
   OnBoard. Until MVTA confirms that upload is available, save each batch to
   the shared folder MVTA names; MVTA loads it into OnBoard later. Keep the
   paper as set out in Count Sheet Retention and Handling.
4. Staff MVTA designates, such as the incoming Contractor's OCC staff in
   training, enter scanned sheets in OnBoard. MVTA Planning compares those
   entries with the Access database, trip by trip, and resolves any
   difference. Entering every sheet is not required; MVTA Planning sets how many
   service dates to compare.
5. If MVTA accepts the comparison, it sets the Cutover Date, normally the
   first day of a following month, and may set it before the Parallel Run
   has ended, on a comparison of part of it. The Access Database then remains
   available, but is not used for new service dates, until MVTA accepts the
   whole Parallel Run. If MVTA does not accept it, the Parallel Run continues.
6. From the Cutover Date, OnBoard is the only record. The Access data-entry
   form is retired and is no longer used.
7. The entry deadline, Flags, Month Close and Reporting Failures do not
   apply to the Parallel Run. They are assessed for service dates from the
   Cutover Date, subject to the Transition and Ramp-Up Periods in
   Attachment G.
8. If MVTA directs in writing that OnBoard cannot be used after the Cutover
   Date, return to the current process until MVTA sets a new Cutover Date.

NOTE: A change of operations contractor does not restart or skip a stage. The
stage in effect continues, and the incoming Contractor's staff take over its
steps from their first day of service.

### Training and Access

**Carried out by:** Contractor Training and Safety staff and Contractor
Operations Management.

1. Train every Operator, check-in desk staff member and Contractor OCC staff
   member on the parts of this SOP they perform, before they perform them, and
   in refresher training each year. Record the training in the Contractor's
   training records.
2. Request OnBoard access for Contractor OCC staff through the IT Service
   Desk before they enter sheets. MVTA assigns the Ridership recorder role.
   Each person uses only their own account.
3. Request removal of OnBoard access through the IT Service Desk on the day a
   person leaves the role.

## Escalation Matrix

Most problems in this SOP threaten the entry deadline, so they are raised the
same day to whoever can fix them. The table collects every escalation this
SOP requires in one place.

| Event | Escalation Level | Notify | Method | Response Time |
|---|---|---|---|---|
| No Count Sheet issued for the assigned block | Garage | Garage Manager | In person | Before pull-out |
| Count Sheets cannot be printed from OnBoard | Contractor management and IT | Contractor Operations Management and IT Service Desk | Phone and Service Desk ticket | Before the first pull-out |
| Count Sheet lost or damaged during service | OCC and garage | OCC and Garage Manager | In person or MDT | At pull-in |
| Count Sheet not returned at pull-in | Garage | Garage Manager | In person or phone | Same day |
| APC equipment not active at pull-out | IT Service Desk and OCC | IT Service Desk | Ticket; OCC by MDT or radio | Before pull-out |
| OnBoard unavailable for entry | IT and Contractor management | IT Service Desk and Contractor Operations Management | Service Desk ticket and email | Promptly |
| Access Database unavailable (before the Cutover Date) | IT and MVTA Planning | IT Service Desk and MVTA Planning | Service Desk ticket and email | Promptly |
| Block shown as Unassigned in OnBoard | MVTA Planning | MVTA Planning | Email | Within one business day |
| A Count Sheet will miss the entry deadline | Contractor management | Contractor Operations Management | Email | Before the deadline |
| A person leaves a role that holds OnBoard ridership access | IT | IT Service Desk | Service Desk ticket | The day the person leaves the role |

## Required Records

Every step that changes a Count leaves a record, so that a Count, a Flag
answer or a Reporting Failure can be traced back to the sheet. The table names
each record and where it is kept.

| Record | System of Record | Owner | Retention | Disposal |
|---|---|---|---|---|
| Count Sheet (paper, per block per service date, including Reconstructed sheets and damaged originals) | Contractor, at the garage | Contractor Operations Management | Until MVTA confirms the month's assessment is final and its dispute period has passed | Secure destruction |
| Counts before the Cutover Date | Access Database | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Counts as entered, with who and when | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Flag answers (correction or confirmation, with note) | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Month Complete and Month Close, and changes to closed months | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Parallel Run comparison and MVTA's acceptance | MVTA Planning records | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Written notices of each transition stage and the Cutover Date | MVTA Operations records | MVTA Operations | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Written APC authorizations | MVTA Operations records | MVTA Operations | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Confirmed Reporting Failures | OnBoard | MVTA Compliance | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Training on this SOP | Contractor training records | Contractor Training and Safety | At least 3 years after the Contract expires | Per MVTA records retention schedule |

## Performance Metrics

The contract's three terms (all trips, accurately and timely) are each
measured, in OnBoard, for service dates from the Cutover Date. During the
Parallel Run they are not measured, because OnBoard is not the entry system.

| Metric | Target | Measurement Method | Frequency | Owner |
|---|---|---|---|---|
| Completeness | A Count for every trip that operated | OnBoard completeness view | Daily | Contractor OCC staff |
| Timeliness | Every Count Sheet entered by the end of the calendar day after the service date | OnBoard entry timestamps | Daily | Contractor OCC staff |
| Accuracy | Every Flag answered by the 5th of the following month | OnBoard Flags | Monthly | Contractor OCC staff |
| Month Complete | Marked by the 5th of the following month | OnBoard | Monthly | Contractor OCC staff |
| Month Close | Closed by the 10th of the following month | OnBoard | Monthly | MVTA Planning |
| Reporting Failures | None | Reporting Failures confirmed by MVTA Compliance | Monthly | MVTA Compliance |
| Reconstructed sheets | Reported, no target | OnBoard, by garage and Operator | Monthly | Contractor Operations Management |

## References

The documents below are the ones this SOP relies on. A document marked Not
registered has no code in the MVTA document registry yet.

| Document | Document Code |
|---|---|
| General Bus Operations | OPR-038-00 |
| Avail Mobile Data Terminal (MDT) Operations | OPR-061-00 |
| Operator Attendance and Reporting For Duty | OPR-123-00 |
| Contract C-10235 — Operations and Maintenance Services | Not registered |
| Attachment G — Performance Standards and Penalties | Not registered |
| MVTA Records Retention Schedule | Not registered |
| MVTA Master Transit Glossary | Not registered |
| MVTA Technology SOPs (ITMS and IT Service Desk) | Not registered |

## Sign-Off Approval Workflow

This SOP is not in effect until every signature row is completed by an
authorized party.

| Role | Name | Signature | Date |
|---|---|---|---|
| Contractor Representative | | | |
| MVTA Representative — COO or Designated Authority | | | |
