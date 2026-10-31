# Ridership Counting and Reporting Procedure — DRAFT

**Status:** draft for MVTA Planning and Operations to review before issue to the
Contractor. Drafted 2026-10-30 from the decisions in
`plans/ridership-counting-spec.md`. Effective for service from 2027-01-01, with
parallel entry in December 2026.

## 1. Purpose

MVTA uses ridership counts for service planning, funding and performance
reporting. The operations contract requires Operators to conduct passenger
counts on all trips in accordance with MVTA's procedures and standards and to
record them accurately and in a timely manner, and makes the Contractor
responsible for training, supervising and monitoring its employees so that this
procedure is followed. This document is that procedure.

## 2. Scope

All fixed-route revenue trips, scheduled or added. MVTA Connect ridership is
taken from Spare and is not counted by Operators. Special-event counting is
covered separately.

## 3. Definitions

| Term | Meaning |
|---|---|
| **Count Sheet** | The sheet for one block on one service date, printed from OnBoard, listing that block's trips. |
| **Count** | The number of passengers who boarded on one trip. |
| **Service date** | The operating day a trip belongs to, in Central time. |
| **Flag** | A question MVTA or OnBoard raises about a count that looks unusual. |
| **Month close** | MVTA's acceptance of a month's counts as final for reporting. |

## 4. Roles

| Role | Responsibility |
|---|---|
| **Operator** | Counts every boarding passenger on every trip of the assigned block and records each trip's total on the Count Sheet. |
| **Check-in desk / Garage Manager** | Prints the next day's Count Sheets, issues one to each Operator at pull-out, collects completed sheets at pull-in. |
| **Contractor OCC staff** (OnBoard role: Ridership recorder) | Enters every sheet in OnBoard by the deadline, answers flags, marks the month complete. |
| **Contractor management** | Trains Operators and staff on this procedure, monitors completeness and timeliness in OnBoard, and keeps the paper sheets. |
| **MVTA Planning** (OnBoard role: Ridership manager) | Maintains the block-to-garage list, reviews counts, raises flags, closes the month. |
| **MVTA Compliance** | Reviews and confirms any reporting failures before they are assessed. |

## 5. Procedure

### 5.1 Before service — Count Sheets

1. Each evening, the check-in desk prints the next service date's Count Sheets
   from OnBoard: one per block.
2. At pull-out, the check-in desk gives each Operator the sheet for the
   assigned block.

### 5.2 During service — Operators

1. Write your name, Operator ID and bus number on the sheet.
2. Count every boarding passenger on every trip on the sheet. Record the trip's
   **total boardings** in the trip's row.
3. Record actual observations only. Do not estimate or round.
4. If you operate a trip that is not on your sheet (extra service, a tripper,
   an OCC-directed trip), write its route, direction, start time and count in
   the blank rows at the bottom.
5. If a trip on your sheet did not operate, write "Did not operate" in its row.
6. At pull-in, hand the completed sheet to the check-in desk.
7. If your sheet is lost or damaged, tell the check-in desk and the OCC at
   pull-in, and reconstruct the counts as accurately as you can on a new sheet,
   marked **Reconstructed**.

### 5.3 Same day — check-in desk

1. Confirm a sheet has come back for every block that operated.
2. Pass completed sheets to Contractor OCC staff for entry.
3. Follow up the same day on any sheet not returned.

### 5.4 Entry — Contractor OCC staff

1. In OnBoard, open **Ridership entry**, choose the service date and block.
2. Check the operator and bus OnBoard shows (taken from the Avail login).
   If the sheet shows a different operator or bus, change it to match the
   sheet.
3. Enter each trip's count from the sheet.
4. Add any extra trips written on the sheet with **Add trip**, giving the
   reason.
5. If the sheet is marked Reconstructed, tick **Reconstructed**.
6. **Deadline:** every sheet must be entered by **the end of the calendar day
   after the service date**.
7. Use the **Completeness** view at least once each day to find trips that
   still need a count, by garage.

### 5.5 Flags — Contractor OCC staff

1. OnBoard flags a count that is far above, or zero against, the same trip's
   recent weeks; MVTA Planning can also flag any count.
2. For each flag, either **correct** the count from the paper sheet, or
   **confirm** it with a short note.
3. All flags for a month must be answered **by the 5th of the following
   month**.

### 5.6 Month close

1. **By the 5th** of the following month, Contractor OCC staff mark the month
   **complete** in OnBoard once every sheet is entered and every flag answered.
2. **By the 10th**, MVTA Planning reviews and **closes** the month.
3. After close, counts can be changed only if MVTA Planning reopens the month;
   every such change is recorded.

### 5.7 Record keeping

1. The Contractor keeps the paper Count Sheets until the month's performance
   assessment is final and the dispute period has passed. MVTA will confirm
   when sheets for a month may be destroyed.
2. Count Sheets carry Operator names and IDs. Store them securely and do not
   share them outside the Contractor and MVTA.

## 6. Performance standards

| Standard | Measure |
|---|---|
| Complete | A count for every trip that operated |
| Timely | Entered by the end of the calendar day after the service date |
| Accurate | Every flag answered by the 5th of the following month |

Each Count Sheet (one block, one service date) that is **missing**, **entered
late**, or has a **flag unanswered at month close** is a reporting failure
under the Attachment G **Incident and Data Reporting** standard. MVTA Compliance
reviews each one before it is assessed. A reconstructed sheet entered on time
is not a failure.

## 7. Transition

- **December 2026:** sheets are entered in **both** the Access database and
  OnBoard. Access remains the record for December.
- **From 1 January 2027:** OnBoard is the only record. The Access data-entry
  form is retired.

## 8. Training

The Contractor trains every Operator, check-in desk staff member and OCC staff
member on this procedure before they perform it, and records the training.

---

### Items for MVTA review before issue

- OPR-038 "Ridership Counting and Count Sheet Submission" still says
  boardings **and alightings** at **each timepoint**; it must be amended to
  match §5.2 before this is issued.
- Confirm the blank rows for unscheduled trips (§5.2 step 4) and "Did not
  operate" (§5.2 step 5) are on the printed sheet design.
- Confirm the evening print time for §5.1 against when each garage's check-in
  desk is staffed.
