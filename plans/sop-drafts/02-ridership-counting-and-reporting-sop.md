# Ridership Counting and Reporting (DRAFT)

**Status:** draft for MVTA Planning and Operations, 2026-10-30. Written in the
layout of the MVTA SOP source template (v1.1.2) used by OPR-038-00, from the
decisions in `plans/ridership-counting-spec.md`. Items marked **[Decide]** are
listed in `03-decisions-before-issue.md`. The document code is a placeholder
until MVTA registers it.

| Field | Value |
|---|---|
| Document type | SOP — Standard Operating Procedure |
| Document title | Ridership Counting and Reporting |
| Category code | OPR |
| Department | Operations |
| Author | |
| Author role | |
| Distribution | External |
| Existing document ID | OPR-XXX-00 (to be registered; this is its first issue, Revision 00) |
| Related documents | OPR-038-00, OPR-061-00, OPR-123-00 |
| Figures | None |

## Scope

This Standard Operating Procedure sets out how ridership is counted, recorded,
checked and reported for MVTA fixed-route bus service, from the printing of a
Count Sheet to MVTA's close of the month's counts.

This SOP applies to every MVTA fixed-route revenue trip, scheduled or added,
and to the personnel who count, collect, enter and review ridership: Bus
Operators, check-in desk staff and Garage Managers, Contractor OCC staff,
Contractor Operations Management, Contractor Training and Safety staff, MVTA
Planning and MVTA Compliance.

The General Bus Operations SOP (OPR-038-00) summarizes the Operator's part of
this procedure and cites this document by code. Other SOPs must cite this
document, OPR-XXX-00, rather than restate it.

This SOP does not govern MVTA Connect ridership, which is taken from the
on-demand scheduling system and is not counted by Operators, or special-event
counts, which are covered separately. **[Decide]** Deadhead movements are not
counted.

## Purpose

MVTA reports ridership to its board, to the Metropolitan Council and to the
National Transit Database, and uses it to plan service and to apply for
funding. A count that is missing, late or wrong carries into each of those.

The operations contract requires Operators to conduct passenger counts on all
trips in accordance with MVTA's procedures and standards, and to record them
accurately and in a timely manner. It makes the Contractor responsible for
training, supervising and monitoring its employees, and for ensuring that
MVTA's ridership counting and reporting procedures are implemented and
consistently followed. This SOP is that procedure. It gives each of the
contract's terms a measurable standard: **all trips** means a count for every
trip that operated; **timely** means entered in OnBoard by the end of the
calendar day after the service date; and **accurately** means every question
MVTA raises about a count is answered from the sheet before the month closes.

## Definitions

The following terms are used throughout this document. Each aligns with the
MVTA Master Transit Glossary. **[Decide]**

| Term | Definition |
|---|---|
| APC (Automatic Passenger Counter) | Onboard equipment that counts passengers boarding and alighting at each stop. |
| Block | A scheduled sequence of trips assigned to a vehicle during a service day. At MVTA a block is one Operator's assignment. |
| Block-to-Garage List | The list, kept by MVTA Planning in OnBoard, of which garage operates each block in the current service change. |
| Count | The number of passengers who boarded on one trip. |
| Contractor | The operations contractor MVTA engages for fixed-route service at the time. |
| Count Sheet | The sheet for one block on one service date, printed from OnBoard, on which the Operator records the Count for each trip. |
| Cutover Date | The first service date on which OnBoard is the only record of ridership, set by MVTA in writing. |
| Flag | A question about a Count that OnBoard or MVTA Planning raises because the Count looks unusual. A Flag is a question, not a finding. |
| Missed Trip | A scheduled trip that is not operated as planned. |
| Month Close | MVTA Planning's acceptance of a month's Counts as final for reporting. |
| Month Complete | The Contractor's declaration in OnBoard that every Count Sheet for a month is entered and every Flag answered. |
| OnBoard | MVTA's operations console, the system of record for ridership Counts from the Cutover Date. |
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
| Check-In Desk Staff and Garage Managers | Print the next service date's Count Sheets from OnBoard, issue each Operator the sheet for the assigned block, collect completed sheets at pull-in, follow up the same day on any sheet not returned, pass sheets to Contractor OCC staff, and store sheets as this SOP requires. |
| Contractor OCC Staff (OnBoard role: Ridership recorder) | Enter every Count Sheet in OnBoard by the deadline, add Unscheduled Trips, review completeness daily, answer every Flag, and mark each month complete. |
| Contractor Operations Management | Supervise and monitor compliance with this SOP: review completeness and timeliness in OnBoard, correct repeated Operator or staff failures, request and remove OnBoard access for Contractor staff, and keep the paper Count Sheets for the required period. |
| Contractor Training and Safety Staff | Train every Operator, check-in desk staff member and OCC staff member on this SOP before they perform it, and keep the training records. |
| MVTA Planning (OnBoard role: Ridership manager) | Maintain the Block-to-Garage List and the Flag settings, review Counts, raise Flags, close each month and reopen a closed month when a correction is needed. |
| MVTA Compliance | Review each Reporting Failure OnBoard proposes at Month Close and confirm or dismiss it before it is assessed. |

## Procedures

The procedures below follow a Count Sheet from printing to Month Close. Each
names the role that carries it out.

### Block-to-Garage List

OnBoard reports completeness by garage, so it must know which garage operates
each block. MVTA Planning sets this up once for each service change.

1. Before each service change takes effect, enter or update the
   Block-to-Garage List in OnBoard for the new service change.
2. Review the completeness view after the first service date of the change.
   A block shown as **Unassigned** has no garage on the list; add it.

NOTE: A block with no garage is still counted and still required. It appears
as Unassigned so the gap is visible rather than silent.

### Count Sheet Printing and Issue

Every Operator needs the right sheet before the first trip. OnBoard prepares
the next service date's sheets overnight from the day's scheduled trips: one
sheet per block, listing each revenue trip's route, direction, scheduled start
and end times and trip ID, with a QR code identifying the block and service
date. The Operator name and bus are left blank, because Operators are assigned
just before pull-out.

1. Each day, before the first pull-out of the next service date, print that
   service date's Count Sheets from OnBoard for every block your garage
   operates. **[Decide]** the print time against garage staffing.
2. Check that a sheet has printed for every block on the day's pull-out list.
   Reprint any missing sheet from OnBoard.
3. At check-in, give each Operator the Count Sheet for the assigned block and
   service date, as part of the run packet (OPR-038-00, Operator Check-In and
   Check-Out).
4. If OnBoard is unavailable and sheets cannot be printed, notify Contractor
   Operations Management and the IT Service Desk, and issue blank Count
   Sheets on which the Operator writes the block, service date and each trip.
   **[Decide]**

### Counting on the Trip

The Count is the number of passengers who boarded the trip. One total per trip
is recorded; alightings and counts by timepoint are not.

1. Before your first trip, write your name, Operator ID and bus number on the
   Count Sheet. If you change buses during the block, write the new bus number
   beside the first trip operated on it.
2. Count every passenger who boards on every trip printed on the sheet,
   including passengers who board with a pass, a transfer or no fare.
3. At the end of each trip, write the trip's total boardings in that trip's
   row.
4. Record actual observations only. Do not estimate or round.
5. If you operate a trip that is not on your sheet, write its route,
   direction, start time and boardings in a blank row at the bottom of the
   sheet. **[Decide]**
6. If a trip on your sheet did not operate, write "Did not operate" in its
   row. Do not write 0. **[Decide]**
7. Complete the Count Sheet on every trip, including on a bus with APC
   equipment, unless MVTA has authorized otherwise in writing (Automatic
   Passenger Counters, below).

REQUIREMENT: Do not write on the Count Sheet while the vehicle is moving.
Record each trip's total at the end of the trip, when the vehicle is stopped.

### Lost or Damaged Count Sheets

1. If your Count Sheet is lost or damaged during service, notify the OCC and
   the Garage Manager at pull-in.
2. Reconstruct the counts as accurately as you can on a new Count Sheet for
   the same block and service date, and write **Reconstructed** across the
   top.
3. Hand in the Reconstructed Count Sheet, and the damaged original if you
   still have it, at pull-in.

NOTE: A Reconstructed Count Sheet entered on time is not a Reporting Failure.
OnBoard reports how often sheets are reconstructed, by garage and Operator,
so that repeated losses can be addressed.

### Pull-In and Sheet Collection

1. At pull-in, the Operator hands the completed Count Sheet to the check-in
   desk as part of check-out (OPR-038-00, Pull-In and End-of-Shift
   Procedures).
2. Check the sheet before the Operator leaves: name, Operator ID and bus
   number are filled in, and every trip row has a Count, "Did not operate" or
   a written reason.
3. By the end of the shift, confirm that a sheet has come back for every block
   that operated. Follow up the same day with the Operator of any block whose
   sheet is missing.
4. Pass completed sheets to Contractor OCC staff for entry at least
   **[Decide]** times a day, and keep entered sheets together by service date
   and garage.

REQUIREMENT: A Count Sheet must not be altered after it is handed in. A
correction is made in OnBoard, where it is recorded, never on the paper sheet.

### Entering Count Sheets in OnBoard

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
4. For a trip marked "Did not operate", record it as not operated. A trip
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

MVTA checks every Count against the same trip's recent history. OnBoard raises
a Flag on a Count that is far above the same trip's usual Count, or zero when
the trip usually carries passengers. MVTA Planning may also flag any Count.

1. OnBoard compares each trip's Count with the same trip (route, direction,
   scheduled start and day type) over the previous four weeks, and flags a
   Count that is:
   - more than three times the median and at least 10 above it; or
   - zero when the median is 5 or more.

   MVTA Planning sets these thresholds in OnBoard and may change them.
2. Contractor OCC staff open each Flag under **Ridership**, **Flags**, and
   check the Count against the paper sheet.
3. If the Count was entered wrongly, **correct** it to match the sheet.
4. If the Count matches the sheet, **confirm** it, with a short note giving
   any reason known (for example, a school group or an event).
5. Answer every Flag for a month by the **5th** of the following month.

NOTE: Confirming a Flag is not an admission of error. A Flag asks the
Contractor to check the sheet; a confirmed Count stands.

### Month Close

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

1. At Month Close, OnBoard proposes a Reporting Failure for each Count Sheet
   (one block on one service date) that is:
   - **missing**: a block that operated has no sheet entered;
   - **late**: entered after the end of the calendar day after the service
     date; or
   - **unanswered**: carries a Flag still unanswered at Month Close.

   A sheet counts once, however many of these apply.
2. MVTA Compliance reviews each proposed Reporting Failure with its evidence
   and confirms or dismisses it.
3. Each confirmed Reporting Failure is assessed under the Incident and Data
   Reporting standard of Attachment G. **[Decide]**

REQUIREMENT: Missing, late and unanswered Count Sheets may result in penalties
and corrective action under Attachment G. A Reconstructed Count Sheet entered
on time is not a Reporting Failure.

### Count Sheet Retention and Handling

Count Sheets are the evidence for the Counts and for any Reporting Failure, and
they carry Operator names and IDs.

1. Keep every paper Count Sheet, filed by garage and service date, until
   MVTA confirms that the month's performance assessment is final and its
   dispute period has passed.
2. Produce any Count Sheet MVTA requests within **[Decide]** business days.
3. Store Count Sheets securely. Do not share them, or the Operator names and
   IDs on them, outside the Contractor and MVTA.
4. When MVTA confirms a month, destroy its Count Sheets securely.

NOTE: OnBoard shows Operator names only to the Ridership recorder and
Ridership manager roles and to MVTA Compliance. Other OnBoard users and
exports see Counts without names.

### Automatic Passenger Counters

Some MVTA buses carry APC equipment. Until APC Counts have been shown to agree
with manual Counts, the Count Sheet remains the record on every trip.

1. Complete the Count Sheet on every trip, whether or not the bus has APC.
2. Verify at pull-out that the APC equipment is active, as part of the
   pre-trip inspection (OPR-038-00, Pre-Trip Inspection Requirement). Report a
   faulty counter as an in-vehicle technology issue.
3. MVTA may authorize in writing that a bus or route no longer needs a Count
   Sheet, once its APC Counts meet criteria MVTA sets. **[Decide]** Until MVTA
   does so, no one else may excuse a Count Sheet because APC is installed.

### Transition from the Access Database

Until OnBoard takes over, the current process continues. Operators complete a
Count Sheet with one total per trip, check-in desk staff collect the sheets,
and Contractor OCC staff key them into MVTA's Microsoft Access ridership
database, which is the record. MVTA moves ridership to OnBoard in three
stages. MVTA sets the start of each stage and gives the Contractor written
notice at least **[Decide]** days in advance.

| Stage | Begins | Count Sheet | Entered in | Record |
|---|---|---|---|---|
| Current process | In effect now | Current sheet | Access | Access |
| Parallel run | The first day of a calendar month MVTA sets | OnBoard sheet | Access and OnBoard | Access |
| OnBoard only | The Cutover Date | OnBoard sheet | OnBoard | OnBoard |

1. Until the parallel run begins, follow the current process. The Access
   database is the record.
2. During the parallel run, print and issue Count Sheets from OnBoard as set
   out in Count Sheet Printing and Issue. Contractor OCC staff enter every
   sheet in **both** OnBoard and the Access database, matching each OnBoard
   trip to its Access row by block and start time. The Access database
   remains the record.
3. The parallel run lasts at least one full calendar month. MVTA Planning
   compares the month's totals in the two systems and resolves any
   difference. If MVTA accepts the result, it sets the Cutover Date as the
   first day of a following month. If not, the parallel run continues.
4. From the Cutover Date, OnBoard is the only record. The Access data-entry
   form is retired and is no longer used.
5. The entry deadline, Flags, Month Close and Reporting Failures are
   practised during the parallel run but not assessed. They are assessed for
   service dates from the Cutover Date.
6. If MVTA directs in writing that OnBoard cannot be used after the Cutover
   Date, return to the current process until MVTA sets a new Cutover Date.

NOTE: A change of operations contractor does not restart or skip a stage. The
stage in effect continues, and the incoming Contractor's staff take over its
steps from their first day of service.

### Training and Access

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

| Event | Escalation Level | Notify | Method | Response Time |
|---|---|---|---|---|
| No Count Sheet issued for the assigned block | Garage | Garage Manager | In person | Before pull-out |
| Count Sheets cannot be printed from OnBoard | Contractor management and IT | Contractor Operations Management and IT Service Desk | Phone and Service Desk ticket | Before the first pull-out |
| Count Sheet lost or damaged during service | OCC and garage | OCC and Garage Manager | In person or MDT | At pull-in |
| Count Sheet not returned at pull-in | Garage | Garage Manager | In person or phone | Same day |
| OnBoard unavailable for entry | IT | IT Service Desk | Service Desk ticket | Promptly |
| Block shown as Unassigned in OnBoard | MVTA Planning | MVTA Planning | Email | Within one business day |
| A Count Sheet will miss the entry deadline | Contractor management | Contractor Operations Management | Email | Before the deadline |

## Required Records

| Record | System of Record | Owner | Retention | Disposal |
|---|---|---|---|---|
| Count Sheet (paper, per block per service date) | Contractor, at the garage | Contractor Operations Management | Until MVTA confirms the month's assessment is final and its dispute period has passed | Secure destruction |
| Counts as entered, with who and when | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Flag answers (correction or confirmation, with note) | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Month Complete and Month Close, and changes to closed months | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Confirmed Reporting Failures | OnBoard | MVTA Compliance | Per MVTA records retention schedule | Per MVTA records retention schedule |
| Training on this SOP | Contractor training records | Contractor Training and Safety | At least 3 years after the Contract expires | Per MVTA records retention schedule |

## Performance Metrics

| Metric | Target | Measurement Method | Frequency | Owner |
|---|---|---|---|---|
| Completeness | A Count for every trip that operated | OnBoard completeness view | Daily | Contractor OCC staff |
| Timeliness | Every Count Sheet entered by the end of the calendar day after the service date | OnBoard entry timestamps | Daily | Contractor OCC staff |
| Accuracy | Every Flag answered by the 5th of the following month | OnBoard Flags | Monthly | Contractor OCC staff |
| Month Complete | Marked by the 5th of the following month | OnBoard | Monthly | Contractor OCC staff |
| Month Close | Closed by the 10th of the following month | OnBoard | Monthly | MVTA Planning |
| Reconstructed sheets | Reported, no target | OnBoard, by garage and Operator | Monthly | Contractor Operations Management |

## References

| Document | Document Code |
|---|---|
| General Bus Operations | OPR-038-00 |
| Avail Mobile Data Terminal (MDT) Operations | OPR-061-00 |
| Operator Attendance and Reporting For Duty | OPR-123-00 |
| Contract C-10235 — Operations and Maintenance Services | Not registered |
| Attachment G — Performance Standards and Penalties | Not registered |
| MVTA Records Retention Schedule | Not registered |

## Sign-Off Approval Workflow

This SOP is not in effect until every signature row is completed by an
authorized party.

| Role | Name | Signature | Date |
|---|---|---|---|
| Contractor Representative | | | |
| MVTA Representative — COO or Designated Authority | | | |
