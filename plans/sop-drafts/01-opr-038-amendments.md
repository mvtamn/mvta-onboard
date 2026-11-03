# OPR-038-00 General Bus Operations — ridership amendments (DRAFT)

**Status:** draft for MVTA Planning and Operations, 2026-10-30. Amends
OPR-038-00 so it agrees with the agreed ridership design (one boardings total
per trip) and hands the detail to the new Ridership Counting and Reporting SOP,
cited here as **OPR-RID-00** until MVTA registers its code. These amendments
are issued together with OPR-RID-00 and take effect on the same date.

The placeholder is OPR-RID-00, not OPR-XXX-00, because OPR-038 already uses
OPR-XXX-00 for the Surveillance Video Access and Handling SOP. The Word files are
kept outside git (the repository ignores `*.docx` and is public), next to the
OPR-038 source in the main checkout's `ridership/` folder: OPR-038 with these
changes as tracked changes, and the new SOP built from the OPR-038 template.

Each change below names the place in OPR-038 it replaces. Text not listed is
unchanged.

---

## 1. Header table — Related documents

**Replace:**

> OPR-119-00, OPR-057-00, OPR-061-00, OPR-123-00, OCC-081-00, SR-020, SR-024, SR-150-00

**With:**

> OPR-119-00, OPR-057-00, OPR-061-00, OPR-123-00, OCC-081-00, SR-020, SR-024, SR-150-00, OPR-RID-00

## 2. Definitions — add two terms

| Term | Definition |
|---|---|
| APC (Automatic Passenger Counter) | Onboard equipment that counts passengers boarding and alighting at each stop. |
| Count Sheet | The sheet for one block on one service date on which the Operator records the number of passengers boarding each trip. |

## 3. Responsibilities table

**Bus Operators — replace** "Collect fares, maintain ridership counts, adhere to timepoints…"

**With:** "Collect fares, count boarding passengers on every trip and record each trip's total on the Count Sheet, adhere to timepoints…" (rest of the cell unchanged).

**Garage Managers — replace** "Collect Count Sheets at pull-in."

**With:** "Issue each Operator the Count Sheet for the assigned block at check-in, and collect completed Count Sheets at pull-in, as set out in OPR-RID-00."

## 4. Procedures — Ridership Counting and Count Sheet Submission

**Replace the whole section with:**

> ### Ridership Counting and Count Sheet Submission
>
> MVTA uses ridership data for service planning, funding and performance
> reporting, so every count must reflect what actually happened on the trip.
> Under the operations contract, Operators count passengers on all trips in
> accordance with MVTA's procedures and record the counts accurately and on
> time, and the Contractor trains, supervises and monitors its employees so
> that those procedures are followed.
>
> In summary, each Operator receives a Count Sheet for the assigned block at
> check-in, records the number of passengers who board each trip, and hands
> the sheet in at pull-in. Contractor staff enter every sheet in MVTA's
> ridership system within the deadline MVTA sets, and answer any question MVTA
> raises about an unusual count before MVTA closes the month. The full
> procedure, including the deadlines, Count Sheet printing, entry, month
> close, reporting failures, sheet retention and the move from the Access
> database to OnBoard, is the Ridership Counting and Reporting SOP
> (OPR-RID-00). This section does not repeat it.
>
> 1. Count every passenger who boards on every trip of your assigned block,
>    and record the trip's **total boardings** on the Count Sheet. Do not
>    record alightings or counts by timepoint.
> 2. Do not estimate or round ridership counts. Counts must reflect actual
>    observations.
> 3. Complete the Count Sheet on every trip, including on a bus with APC
>    equipment, unless MVTA has authorized otherwise in writing under
>    OPR-RID-00.
> 4. Submit the completed Count Sheet at pull-in. If it is lost or damaged,
>    notify the OCC and the Garage Manager at pull-in and reconstruct the
>    counts as set out in OPR-RID-00.
> 5. For everything else about completing and submitting the Count Sheet,
>    follow OPR-RID-00.

## 5. Operator Check-In and Check-Out — step 3

**Replace** "Collect your run packet at check-in: the Count Sheet, current Operational Bulletins…"

**With:** "Collect your run packet at check-in: the Count Sheet for your assigned block and service date, current Operational Bulletins…" (rest unchanged).

## 6. Pull-In and End-of-Shift Procedures — step 3

**Replace:**

> Submit the completed Count Sheet to the Garage Manager or the designated
> collection point at pull-in. Count Sheets must reflect actual observed counts
> and must not be altered after submission.

**With:**

> Submit the completed Count Sheet to the Garage Manager or the designated
> collection point at pull-in. Count Sheets must reflect actual observed counts
> and must not be altered after submission. Any correction is made in MVTA's ridership system
> as set out in OPR-RID-00, not on the paper sheet.

## 7. Escalation Matrix

**Keep** the "Count Sheet lost or damaged" row. **Add:**

| Event | Escalation Level | Notify | Method | Response Time |
|---|---|---|---|---|
| No Count Sheet issued for the assigned block | Garage | Garage Manager | In person | Before pull-out |

## 8. Required Records

**Replace** the "Count Sheet (per block)" row **with:**

| Record | System of Record | Owner | Retention | Disposal |
|---|---|---|---|---|
| Count Sheet (paper, per block per service date) | Contractor, at the garage | Contractor management | Until the month's performance assessment is final and its dispute window has passed (OPR-RID-00) | Secure destruction once MVTA confirms the month |
| Ridership counts as entered | OnBoard | MVTA Planning | Per MVTA records retention schedule | Per MVTA records retention schedule |

## 9. References — add

| Document | Document Code |
|---|---|
| Ridership Counting and Reporting (to be developed) | OPR-RID-00 (Not registered) |

---

## Noticed in OPR-038 but outside this amendment

- The On-Time Performance definition and Performance Metrics say up to
  **15 minutes** late; Timepoint Adherence says **5 minutes**. Not changed
  here.
