# Ridership Reconciliation — Review

Date: 2026-10-31. **Not implemented.** A review of how MVTA's fixed-route
ridership is checked, balanced and closed today, from daily entry through
monthly totals to external (NTD) reporting, and how each step lands in OnBoard.

It builds on the agreed decisions in `plans/ridership-counting-spec.md` and
does not reopen them. Gap IDs (C1, P4, D3 …) are from
`plans/ridership-counting-gaps.md`, and increments are from
`plans/ridership-build-plan.md`. New gaps found here are numbered **R1–R12**
(§6).

Out of scope, because other work covers it:

- The APC comparison and APC health design (spec §12, §14) and the sessions
  working on them.
- The contractor SOP wording (branch `claude/ridership-sop-3b06a2`).
- The operator app (PR #458).
- The ridership UI build (PR #457).

This review only says where those pieces touch reconciliation.

## Sources

- Planning's two procedures in the untracked `ridership/` folder: *Updating
  the Ridership Database* (the roster build) and *Updating the Monthly
  Ridership Report* (the checks, month close and workbook).
- The `FixedTotals` export, Jan–Sep 2026: 744 rows of aggregates, with no
  personal data.
- The spec, the gaps record, the procedure draft and the build plan.
- OnBoard: `TripStartLog` / `tripStartLogMaterialize`, `FixedRouteDepartures`,
  `lib/missedTripCase/`, `lib/occurrenceIntake/`, `lib/otpMonth/`,
  ADR 0006 / 0032 / 0033 / 0039.

**The Access files are not in the folder.** `ridership/` holds no `.mdb` or
`.accdb`, and none exists anywhere under the home folder. mdbtools is not
installed either. So the Access queries (*append data entry to archive*,
*append fixed total table*, *delete from recent riders table*, *Fixed totals
by Route > Month*) are described from Planning's procedure, not read from
their SQL. Anything here that depends on their exact logic is marked
**inferred**. Open question Q1 asks for the files.

## 1. What the `FixedTotals` export shows

The export is the only output of reconciliation we hold. Read with that in
mind, it shows five things:

1. **The grain is month × route × direction × day type × ServiceType.** Two
   cases that look like duplicates (495 in March, 436 in May) are one route
   carrying two ServiceTypes (DX + L, RC + L). So ServiceType is part of the
   key, not just a label. This reinforces Q15: an export with ServiceType
   blank collapses those rows, and the workbook would see different row
   counts from the history.
2. **`Trips` appears to count roster rows, including uncounted trips
   (inferred).** In most rows `AvgRiders` = `SumOfRiders ÷ Trips`. In 5 rows
   it is higher. For example, 465 N weekday September has 377 trips and 7,171
   riders, which works out to 19.0, but the row says 19.1. That fits an
   average taken over the trips that had a number, with `Trips` counting
   every roster row. If so, the monthly total silently drops uncounted trips,
   and nothing records how many there were (R1).
3. **Day counts are not in the table.** `Date` is the first of the month. The
   number of weekdays, Saturdays and Sundays is typed into the workbook from
   the service calendar (P3). The averages people quote ("average weekday
   ridership") depend on that typed figure.
4. **Routes drop out with no record.** 412 is absent from April, and 472,
   484 and 489 from June. 493 is absent from September. These are probably
   service changes, but nothing in the reconciliation separates "route
   discontinued" from "route's counts never arrived" (R2).
5. **The September jump (D3) passes every check in today's process.**
   Ridership rose 27% on flat trip counts (14,616 vs 14,536), and riders per
   trip went from 6.70 to 8.46. A rise spread across routes never trips "sort
   largest to smallest", and it would not trip the spec's per-trip outlier
   rule either unless single trips tripled. Only a **route-month comparison
   at close** catches it (R3).

## 2. The process today, step by step

**Who does what:**

| Who | Steps | Tools |
|---|---|---|
| **Planning** (MVTA) | Everything except counting and entry | Optibus exports, three Excel workbooks, the Access back end (data-entry copy), the Access *Ridership Data Manager* front end, the monthly report workbook, Spare export, special-events tracker |
| **SST OCC** (today's contractor; Keolis from 2027-01-01) | Entry and corrections | Access entry form |
| **Operators** | Counting | Paper Count Sheet |

**Steps:**

| # | Step | Who / tool | Inputs → outputs | Failure modes |
|---|---|---|---|---|
| T1 | **Roster build**, monthly or each service change | Planning; Optibus → *1. Vehicle Schedule* → *2. Riders Base* → `Riders_FINAL` | Optibus trip properties + one vehicle schedule per service type → one row per trip per date | Leftover rows from the previous pick; formula columns not checked; block `'000'` format must be the last edit or the import breaks (P1, P3) |
| T2 | **Day type tagging** | Planning, typed per Riders Base (Wk/Sat/Sun/SpSat) | Service type → `Days` column | Typed by hand; a holiday on a Sunday schedule depends on the person knowing (P3) |
| T3 | **Roster import** | Planning; Access back end opened past its startup form, *External Data → Text File → append to `Riders`* | `Riders_FINAL` CSV → entry rows | Double import has no guard; "save design changes? Yes" damages the file (P3, P5) |
| T4 | **Count** | Operator, paper sheet | Boardings → one total per trip, by route and time range | Sheet has no trip ID or direction (D2); SOP says boardings + alightings per timepoint (C1) |
| T5 | **Collection** | Check-in desk | Sheets at pull-in | No list of sheets expected vs returned; missing sheets show up only as blanks at month end |
| T6 | **Entry** | SST OCC, Access form, 2–3 times a day | Sheet lines → `Riders` values | OCC matches each line to a row by route + time by hand (D2); some rows have blank `TripID` (D1); no deadline (C2); no record of who keyed what (P6) |
| T7 | **Blank check** | Planning, filter `riders` for blanks in *SST recent riders* | Month's rows → list of blanks | A blank can mean "not counted", "did not operate" or "not keyed yet", and they can't be told apart; checked only at month end |
| T8 | **Outlier check** | Planning, sort largest → smallest, route by route | Rows → trips that "seem too large" | By eye, no expected range (C3, P4); zeros and low values are not checked; route-month swings are not checked (D3) |
| T9 | **Correction loop** | Planning emails trips to SST; SST corrects in Access | Email → edited values | No record of what was flagged, changed, or by whom (P6); no deadline |
| T10 | **Archive** | Planning runs *append data entry to archive* for the month's dates, after checking the month is not already in `Riders` | Entry table → `Riders` (archive) | Guard is a manual sort; a wrong date range double-appends or skips days (inferred) |
| T11 | **Roll-up** | Planning runs *append fixed total table* | `Riders` → `FixedTotals` (month × route × direction × day type × ServiceType: trips, riders, average) | Re-running appends the month again; uncounted trips are counted in `Trips` but not in riders (§1, inferred) |
| T12 | **Purge** | Planning runs *delete from recent riders table*, keeping ≥ 2 months | Entry table trimmed | Wrong cutoff deletes unarchived data; backups are "periodic" |
| T13 | **Workbook load** | Planning copies filtered `FixedTotals` into *Raw – Rte Month*, types day counts (column J), rebuilds the `route + day type` key | `FixedTotals` → workbook rows | Paste position, header row, day counts typed (P3) |
| T14 | **Add Connect and special events** | Planning, from the Spare export and the special-events tracker | Spare trip export, tracker → workbook rows | Connect bucketed by UTC month (D5); counting rule undocumented (D4); event counts on paper or not (C7) |
| T15 | **Control-total check** | Planning compares the workbook's *Total by Month by Route* with Access *Fixed totals by Route > Month* | Two totals → match or hunt | The only balancing step, done by hand once a month |
| T16 | **Report checks** | Planning; YoY by route and by service type totals checked against each other; green tabs spot-checked; "last revised" dates typed per chart | Workbook → checked charts | By eye; "last revised" typed by hand (P7) |
| T17 | **Publish** | Planning, PDF of the green tabs | Workbook → *Ridership Report (Month).pdf* | No record that a month is closed, or of who closed it (P7) |
| T18 | **External reports**, including NTD monthly and annual | Planning, from a reporting tracker and a separate how-to (not in the folder) | Report figures → NTD and other submissions | Not reviewed; their inputs, deadlines and owners are Q2 |

What today's process does **not** have at all:

- A check that every scheduled trip has a count (completeness).
- A deadline.
- A trail of corrections.
- A recorded close.
- A way to change a reported month on the record.

## 3. Where each step lands in OnBoard

| # | Today | OnBoard | Where |
|---|---|---|---|
| T1 | Roster build | **Removed.** `TripStartLog` already has one row per revenue trip per service date with Block in `001` form, written today + tomorrow at 04:30 | Existing (Dispatch Log); spec §2 |
| T2 | Day type tagging | `lib/serviceDayType.ts` from the GTFS service a trip ran under. Simple Wk/Sat/Sun for the December comparison (build plan PR 5); full rule incl. SpSat by Jan 1 | Spec §9, Increment 1 PR 5 + Increment 2. **SpSat mapping is a gap (R4)** |
| T3 | Roster import | **Removed** (no import; sheets read `TripStartLog`) | — |
| T4 | Count | Printed sheet with trip ID, direction, QR, DNO and blank rows | Spec §3, PR 4 |
| T5 | Collection | The entry worklist shows every expected sheet and its state, so a sheet not returned surfaces the next morning, not at month end | Spec §4–5, PR 2–3 |
| T6 | Entry | Sheet form keyed by `(service_date, trip_id)`; operator and bus pre-filled from `FixedRouteDepartures` with override; history per change | Spec §4, PR 1–3 |
| T7 | Blank check | **Completeness** (trips needing a count with none), **Not counted** as an explicit status, lateness against the next-day deadline | Spec §5, PR 2–3; Not counted flag in Increment 2 |
| T8 | Outlier check | **Outlier flags** per trip against the same trip over 4 weeks; Planning can raise any flag | Spec §6, Increment 2. **Route-month check is a gap (R3)** |
| T9 | Correction loop | **Flags queue**: contractor corrects or confirms with a note; `RidershipCountHistory` keeps every change | Spec §6, Increment 2 |
| T10 | Archive | **Removed.** Counts are one table; nothing is copied | — |
| T11 | Roll-up | **Monthly totals** computed from counts, `FixedTotals`-shaped export | Spec §9, Increment 2. **Trips denominator is a gap (R1)** |
| T12 | Purge | **Removed.** Entry speed comes from the worklist's date window, not from deleting rows | — |
| T13 | Workbook load | The export replaces the Access copy step. Day counts per day type come from the GTFS calendar | Spec §9, Increment 2. **Day counts not in the export shape (R5)** |
| T14 | Connect / events | Connect from Spare in v2; special events later (C7) | Spec §1, v2 |
| T15 | Control-total check | The export carries **control totals** (rows, trips, riders per month) that the workbook can be checked against; disappears with the v2 report page | Increment 2 (new, small) |
| T16 | Report checks | v2 report page (YoY, by service type) generated from closed months; "last revised" = close or restatement time | Spec §9 v2 |
| T17 | Publish / close | **Month complete** (contractor, by the 5th) → **month close** (Planning, by the 10th) → reopen with reason, restatements | Spec §7, Increment 2; restatements on the ADR 0039 shape plus who/why |
| T18 | External reports | Monthly UPT from closed months (+ Connect in v2) as an export; submission stays human | **New**, v2 (Q2–Q5) |
| — | (none) | **Occurrences**: candidates at close → compliance manager confirms → `INCIDENT_REPORTING` | Spec §8, Increment 3 |
| — | (none) | **December parallel-run reconciliation**, Access vs OnBoard | Build plan PR 5 (daily CSV); sign-off rule is a gap (R6) |
| — | (none) | **`FixedTotals` history import** with control totals | Spec §9, Increment 2; control-total check is a gap (R7) |
| — | (none) | **APC evidence** beside flags, and unmatched APC trips as unscheduled-trip candidates | Spec §12, §14, v2 |

Reuse, not new machinery:

- **Missed-trip cases** settle "did this trip run?". A DNO entry is compared
  with `TripStartLog.start_status` and confirmed `MonitoredMissedTrips` cases
  (build plan decision 5). That is the only cross-system balance inside a day.
- **Occurrence intake** stays the only writer of `ComplianceOccurrences`. It
  gets a `ridership-sheet` source kind next to `missed_trip`,
  `fixed_route_departure` and `on_demand_departure`.
- **Restatements** use the ADR 0039 ledger shape. Ridership changes are made
  by hand, so each one also needs who and why.
- **Frozen periods** follow ADR 0006. Occurrences reach a Final Assessment
  that cannot change, so a ridership reopen after the assessment is issued
  must not silently change an assessed occurrence (R9).

## 4. Automation table

Key:

- **Automated**: runs unattended. The owner is the role accountable for its
  rule or settings.
- **Auto + confirm**: OnBoard proposes or pre-fills, and a named role accepts
  or overrides.
- **Human**: a judgement only a person can make. OnBoard records it.

| Step | Today | OnBoard | Class | Owner role | Increment |
|---|---|---|---|---|---|
| Trip roster per service date | Planning copy/paste from Optibus (T1–T3) | `TripStartLog` materializer | Automated | Engineering (rule); Planning keeps GTFS current | Dec 1 |
| Block → garage list | — | Admin → Ridership setup | Human | `ridership-manager` | Dec 1 |
| Day type per trip | Typed per base file (T2) | From GTFS service | Automated | `ridership-manager` (rule) | Dec 1 simple / Jan 1 full |
| GTFS service → SpSat (and holiday) mapping | Typed (T2) | Proposed from the GTFS calendar each service change, Planning confirms (R4) | Auto + confirm | `ridership-manager` | Jan 1 |
| Count Sheet production | — (pre-printed form) | Server-rendered per block, printed by garage | Automated (print is a human action) | Contractor check-in desk | Dec 1 |
| Expected sheets vs returned | Not done (T5) | Worklist lists every expected sheet; not-entered sheets surface next day | Automated | `ridership-recorder` | Dec 1 |
| Trip matching on the sheet | OCC by route + time (T6) | Sheet rows are `TripStartLog` trips; QR identifies block + date | Automated | — | Dec 1 |
| Operator / bus on the sheet | Typed | Pre-fill from `FixedRouteDepartures`; OCC overrides to match the paper | Auto + confirm | `ridership-recorder` | Dec 1 |
| Keying the counts | Access form (T6) | Sheet form | Human | `ridership-recorder` | Dec 1 |
| Unscheduled trip added | Not possible (no roster row) | OCC adds with reason | Human | `ridership-recorder` | Dec 1 |
| Reconstructed sheet | Not recorded | Checkbox, rate reported by garage and operator | Human | `ridership-recorder` | Dec 1 |
| Completeness (trip needs a count, has none) | Blank filter at month end (T7) | Completeness by garage and date | Automated | `ridership-recorder` (works it); `ridership-manager` (rule) | Dec 1 |
| Lateness (next-day deadline) | No standard (C2) | Sheet state late / entered late, Central time | Automated | `ridership-recorder` | Dec 1 |
| Not counted → question | Indistinguishable blank | Not counted raises a flag | Auto + confirm | `ridership-recorder` answers | Jan 1 |
| DNO vs Dispatch Log / missed-trip case | Not done | Mismatch raises a question; no auto-correction | Auto + confirm | `ridership-recorder` answers; OCC dispatch owns the case | Jan 1 |
| Per-trip outlier detection | Sort by eye (T8) | 4-week same-trip median rule, thresholds as settings | Automated | `ridership-manager` (thresholds) | Jan 1 |
| Answering a flag (correct or confirm) | Email to SST (T9) | Flags queue with note | Human | `ridership-recorder` | Jan 1 |
| Raising a flag by hand | Email | Flag from any trip | Human | `ridership-manager` | Jan 1 |
| Route-month swing check (R3) | Not done (D3 passed) | Close review lists route × day type swings vs prior month and same month last year above a setting | Auto + confirm | `ridership-manager` | Jan 1 |
| Month complete | — | Preconditions checked (every flag answered); contractor marks (R8) | Auto + confirm | `ridership-recorder` | Jan 1 |
| Month close | Implicit in T10–T17 | Planning closes after the close review | Auto + confirm | `ridership-manager` | Jan 1 |
| Archive / roll-up / purge | Three Access queries (T10–T12) | Totals computed from counts; no copy, no purge | Automated | — | Jan 1 |
| Monthly totals (`FixedTotals` shape) | Append query (T11) | Export with trips scheduled / counted / not counted (R1) | Automated | `ridership-manager` | Jan 1 |
| Day counts per day type | Typed in workbook (T13) | Counted from the GTFS calendar, in the export (R5) | Automated | `ridership-manager` (rule) | Jan 1 |
| ServiceType on totals | Optibus trip property | **Blank, unsettled (Q15)**; not designed here | — | `ridership-manager` to decide | Unsettled |
| Control totals for the workbook | Hand check (T15) | Totals sheet in the export | Automated | `ridership-manager` | Jan 1 |
| Reopen a closed month | Edit Access | Reason required; restatement recorded with before/after, who, why | Human (recording automated) | `ridership-manager` | Jan 1 |
| Acting on a restatement of a reported month | Not done | Restatement list shows months already reported externally (R9) | Human | `ridership-manager` | Jan 1 (list) / v2 (external marker) |
| December Access vs OnBoard comparison | — | Daily + monthly CSV by route, direction, day type; differences listed | Auto + confirm | `ridership-manager` signs off (R6) | Dec 1 (daily) / early Jan (December sign-off) |
| `FixedTotals` history import | — | One-off import with per-month control totals vs the Access export (R7) | Auto + confirm | `ridership-manager` | Jan 1 |
| Candidate occurrences | — | Proposed at close: missing, late, flag unanswered | Automated | Engineering (rule) | Early Feb |
| Confirming an occurrence | — | Existing Compliance review | Human | Compliance manager | Early Feb |
| Paper sheet release | Email "until closed out" (C6) | Shown once the month's Assessment Period is final and the dispute window has passed; Planning tells the contractor | Auto + confirm | `ridership-manager` | Early Feb |
| Connect ridership | Spare export by hand (T14) | Spare Ridership Export by Central service date | Automated | `ridership-manager` | v2 |
| Special-event ridership | Tracker by hand (T14) | Not designed (C7) | Human | `ridership-manager` | Later |
| Report charts, YoY, last revised | Workbook (T16–T17) | Report page from closed months | Automated | `ridership-manager` | v2 |
| NTD monthly UPT figure | Reporting tracker (T18) | Export of closed-month UPT by mode (Q3) | Auto + confirm | `ridership-manager` | v2 |
| NTD submission and certification | Planning | Stays outside OnBoard | Human | Planning (NTD reporter) | — |
| APC evidence on a flag | — | Finding shown as context; never settles the flag | Auto + confirm | `ridership-recorder` / `ridership-manager` | v2 |
| APC-only trips (unmatched) as unscheduled candidates | — | Proposed to OCC | Auto + confirm | `ridership-recorder` | v2 |

**The split.** Most of today's hand work is copying and balancing. It goes
away because OnBoard keeps one set of counts against one trip list, so there
is nothing left to balance:

- **Automated:** roster, archive/roll-up/purge, control totals, day counts,
  completeness and lateness.
- **Automated + confirm:** every place where OnBoard's evidence and the paper
  can disagree. That covers the pre-fill, DNO vs Dispatch Log, flags, the
  route-month swing, the close, the December comparison, the history import
  and occurrences.
- **Human:** keying from paper, answering a flag, reopening, confirming an
  occurrence, the garage list, and external submission.

## 5. Human touchpoints and the screen each needs

| Touchpoint | Who | Screen / queue | Status |
|---|---|---|---|
| Key a sheet, override operator/bus, add trip, mark reconstructed | `ridership-recorder` | Ridership → **Enter sheets** worklist → sheet form | Spec §4 (PR 3) |
| Work the day's gaps | `ridership-recorder`; contractor management weekly | **Enter sheets** completeness by garage | Spec §5 (PR 3) |
| Answer a flag (outlier, Not counted, DNO mismatch) | `ridership-recorder` | Ridership → **Flags** queue, one list for every flag kind, oldest first, with the trip's 4-week history and (v2) APC finding | Spec §6 (Increment 2). DNO mismatch and Not counted as **flag kinds in the same queue**, not a second queue |
| Raise a flag | `ridership-manager` | From any trip in the close review or totals drill-down | Spec §6 |
| Mark the month complete | `ridership-recorder` | Ridership → **Month close**: checklist of open flags, sheets still missing (they become occurrence candidates), late sheets | Spec §7 (Increment 2) |
| Close the month | `ridership-manager` | **Month close** review: totals by route × day type vs prior month and same month last year, swings above the setting highlighted, Not counted rate, reconstructed rate, open flags = 0, then Close | Spec §7 + R3 (new panel) |
| Reopen / restate | `ridership-manager` | **Month close** → Reopen with reason; restatement list with before/after and whether the month was already reported externally | Spec §7 + R9 |
| Settings: garage list, flag thresholds, day-type mapping, swing threshold | `ridership-manager` | Administration → **Ridership setup** (`ridership.configure`) | Spec §10; day-type mapping and swing threshold are additions |
| December sign-off | `ridership-manager` | **Totals & export** → December comparison: Access vs OnBoard by route, direction, day type, with differences to explain | Build plan PR 5 + R6 |
| History import check | `ridership-manager` | One-off: per-month control totals vs the Access export, shown before the import is accepted | R7 |
| Confirm occurrences | Compliance manager | Existing **Compliance** occurrence review | Spec §8 (Increment 3) |
| Release paper sheets | `ridership-manager` → contractor | **Month close**: "sheets for {month} may be destroyed" once the Assessment Period is final and the dispute window has passed | C6 + new line |
| External submission (NTD) | Planning | Outside OnBoard, from the export | Q2–Q5 |

## 6. Gaps found by this review

These are additions to the spec, not changes to any decision in it.

- **R1. `Trips` and the average need a definition.** The export should carry
  `TripsScheduled`, `TripsCounted`, `TripsNotCounted`, `TripsDNO`, `Riders`,
  and `AvgRiders` over counted trips. One `Trips` column matching Access's
  (inferred) roster-row count can be derived for the workbook. Whether riders
  are **expanded** for uncounted trips is Q4.
- **R2. A route that drops out needs a reason.** At close, a route present
  last month and absent this month is listed. Planning confirms it
  discontinued (a service change); otherwise it is a completeness problem.
- **R3. There is no route-month check.** The per-trip rule (§6) cannot catch
  D3. The close review compares route × day type with the prior month and the
  same month last year. The threshold is a setting, and Planning notes why
  before closing. This is a review aid, not a flag to the contractor.
- **R4. SpSat and holidays need a mapping.** "The type of the GTFS service"
  (§9) needs a table from GTFS `service_id` to day type, proposed each service
  change and confirmed by Planning. Otherwise a Special Saturday service reads
  as Sat.
- **R5. Day counts belong in the export.** Weekdays, Saturdays, Sundays and
  SpSats per month, from the GTFS calendar, so column J is no longer typed.
- **R6. The December sign-off needs a rule.** Access is the record for
  December. The spec says Planning compares, but not what "agrees" means or
  what happens on a difference. Suggestion: monthly totals by route ×
  direction × day type within an agreed tolerance, with every difference
  explained or traced to an entry error on one side, signed off before
  January's close.
- **R7. The history import needs a control total.** Rows, trips and riders
  per month in OnBoard should equal the Access export before the import is
  accepted. Months with ServiceType splits must keep them.
- **R8. Month complete and missing sheets.** The procedure draft says
  "complete once every sheet is entered and every flag answered". But a sheet
  still missing on the 5th is meant to become an occurrence (§8), so complete
  must be allowed with sheets missing, or the contractor can never mark a
  month complete. Also undefined:
  - whether "complete" locks the contractor's entry;
  - what happens if the contractor never marks complete. Suggestion: Planning
    can close anyway, and the late mark is recorded.
- **R9. Restating a month already reported.** ADR 0039 records the change but
  not the consequences:
  - A reopen after NTD or another report has gone out needs a marker
    ("reported on {date}") and a decision to revise the submission or not.
  - A reopen after the Assessment Period is final must not change an assessed
    occurrence. ADR 0006: correcting it means a Superseding Final Assessment.
- **R10. Planning-side and Engineering-side reconciliation is not in the
  procedure.** The draft covers the contractor. Planning's monthly checklist
  (close review, December sign-off, history import, external reports) has no
  written home. It could be a section of the SOP draft, or a Planning desk
  note.
- **R11. Unscheduled trips have no cross-check.** An added trip is trusted as
  keyed. Two checks are possible:
  - Dispatch Log extra-service records, if dispatch records trippers anywhere
    (Q7).
  - Later, APC trips that match no Dispatch Log trip (spec §12).
- **R12. Trips after midnight.** The SOP draft puts them on the block's
  service date, and `TripStartLog` does too. The **totals month** must use
  the service date, not the clock date, for the month-end night. That is the
  same rule as D5 for Connect.

## 7. Open questions for Planning

1. **The Access files.** Please share `Ridership Data Entry_be.mdb` and
   `Ridership Data Manager.mdb`, or exports of the four named queries' SQL.
   That lets R1, the TripID rule (build plan decision 6) and the archive /
   roll-up logic be confirmed rather than inferred. Also the full
   `FixedTotals` export for the history import (spec §11 step 4).
2. **External reports.** Which ones does the reporting tracker list, with
   which ridership figures, deadlines and recipients? For example: NTD
   monthly, NTD annual, Met Council and board reports. Which of them use the
   closed month, and which use a later revision?
3. **NTD UPT.** Does MVTA report fixed-route UPT from these manual counts as
   a 100% count? If so, how are trips without a count (Not counted, missing
   sheets) handled today: left out, or expanded?
4. **Expansion rule.** Should OnBoard's totals estimate riders for uncounted
   trips (for example, the trip's 4-week median), shown separately from
   counted riders? Or is it counted-only, as `FixedTotals` appears to be?
5. **Passenger miles.** NTD's annual report also needs passenger miles,
   which a boardings total per trip cannot give. How is it produced today (a
   sampling survey?), and should OnBoard support it, or does it wait for
   APC?
6. **Route-month threshold.** What swing should the close review highlight
   (R3)? And was September's +27% real, for example from school service (D3)?
7. **Trippers.** Does dispatch record extra service anywhere today (in Avail
   or on a log) that an added trip could be checked against (R11)?
8. **December sign-off.** What tolerance and who signs off (R6)? If Access and
   OnBoard disagree on a December route, is Access corrected, OnBoard
   corrected, or the difference documented?
9. **Close without "complete".** If the contractor has not marked the month
   complete by the 5th, does Planning close on the 10th anyway (R8)?
10. **Restating a reported month.** When a month is reopened after it was
    reported externally, who decides whether to revise the submission, and
    should OnBoard record that decision (R9)?
11. **SpSat and holidays.** Which GTFS services are Special Saturday, and are
    any holiday services reported as their own day type (R4)?
12. **Special events and Connect in the totals.** Until v2, Planning still
    adds these to the workbook by hand. Should the January export leave room
    for them (empty rows in the same shape), or stay fixed-route only?
13. **ServiceType (Q15).** Still unsettled and not designed here. Without it
    the export collapses rows the history keeps apart (§1), so it needs
    deciding before January's export, or the workbook must accept blank
    ServiceType for 2027.
