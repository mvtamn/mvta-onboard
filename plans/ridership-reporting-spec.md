# Ridership Reporting — Spec

Date: 2026-11-01. **Not implemented. Docs only.** These decisions were agreed
with the user in a grilling session on 2026-11-01 (Q1–Q17 below).

This spec covers **reporting**: what is produced from fixed-route ridership
counts once they are made. Counting and entry are not in scope here. They are
covered by:

- `plans/ridership-counting-spec.md` and `plans/ridership-counting-gaps.md`
  (PR #455)
- `plans/ridership-build-plan.md`, built in PRs #457, #465, #469 and #474
- `plans/ridership-reconciliation-review.md` (PR #459)

Gap IDs refer to those files: P7, D3 and Q15 come from the counting files, and
R1–R12 come from the reconciliation review.

Settled earlier and not reopened here:

- **The count.** One boardings total per trip, on one Count Sheet per block
  per service date.
- **Month close.** The contractor marks the month complete by the 5th, Planning
  closes it by the 10th, and a reopen records restatements.
- **Monthly totals.** Per month × route × direction × day type × service type:
  trips, riders and average.
- **First deliverable.** A `FixedTotals`-shaped export, with the full Access
  history imported once.
- **Operator names.** Visible only to `ridership-recorder`,
  `ridership-manager` and the compliance roles.

- **Transition (plan A, decided 2026-11-03).** OnBoard-printed Count Sheets
  start on the **7 December 2026 service change**. December is a **parallel
  run by scanning**:
  - the incumbent keys **Access only**, and Access is the record for December;
  - garage management scans every sheet daily;
  - Keolis's OCC keys scanned December sheets in OnBoard during training
    (9–18 Dec), and Planning compares those entries with Access before the
    18 Dec conditional cutover notice.

  OnBoard is the record from **1 January 2027**. Keolis never keys Access
  (`plans/contractor-ridership-briefing.md`, PR #463).

**Deliberately unsettled, and not designed around here:**

- **ServiceType** (L/MX/RC/SX/DX), Q15.
- **Connect**, which is v2.

## 1. Today's reports (inventory)

Source: Planning's *Updating the Monthly Ridership Report* and *Updating the
Ridership Database* procedures (both dated 2026-03), the `FixedTotals` export
for Jan–Sep 2026, and Planning's Access screenshots (counting spec §16, added
2026-11-02).

The workbook itself, the Reporting Tracker and the external-report how-to are
**not** in the files reviewed. Rows marked *to verify* are settled by the
report review (§2).

### 1.1 The data behind every report

- **Access `FixedTotals`.**
  - Grain: one row per month × route × direction × `Days of Svc` (Wk/Sat/Sun)
    × `ServiceType`.
  - Columns: `FixedTotalsId, Date, Route, Direction, Days of Svc, ServiceType,
    Trips, SumOfRiders, AvgRiders`.
  - `Date` is the first of the month.
- **How rows are made.** Planning runs the Access query *append fixed total
  table* after archiving the month.
- **Jan–Sep 2026 sample.**
  - 744 rows over 24 routes.
  - ServiceType values: L 524, MX 134, RC 40, SX 28, DX 18.
  - ServiceType is part of the key: 495 and 436 each carry two in one month
    (#459 §1).
- **Known problems.**
  - `Trips` appears to include uncounted trips while the average does not
    (R1).
  - Day counts are not stored (R5).
  - Routes drop out with no reason recorded (R2).
  - September's +27% (123,618 riders against 97,449 in August, on flat trips)
    passed every check (D3, R3).

### 1.2 Report inventory

| # | Report | Who produces it | Source | Steps | How often | Audience | Known problems |
|---|---|---|---|---|---|---|---|
| A | **Monthly Ridership Report workbook**, published as *Ridership Report (Month).pdf* of the green tabs | Planning | `FixedTotals` pasted into *Raw – Rte Month*; day counts typed into column J; Connect from the Spare export; special events from the events tracker | Copy last month's file → edit *Report Vitals* → paste rows → type day counts → rebuild the `route+day` key → extend *Raw – Summary* formulas → balance against the Access query *Fixed totals by Route > Month* → check each tab → type "last revised" dates → PDF | Monthly, after the month is archived | Internal, and external through the PDF | Hand paste and typed day counts (P3); "last revised" typed on every chart (P7); the only control total is checked by hand; Connect bucketed by UTC month (D5) |
| A1 | Tab: Total by Month by Route | Planning | A | Formula | Monthly | Internal | The balancing tab |
| A2 | Tab: Chart Total by Year | Planning | A | Formula + typed date | Monthly | Internal / external | Typed date |
| A3 | Tabs: Avg Weekday and Avg Weekend month over month; Chart Monthly Avg Weekday / Wknd | Planning | A + typed day counts | Formula + typed date | Monthly | Internal / external | The average depends on the typed day count |
| A4 | Tab: Year over Year Total by Route | Planning | A | Formula, checked against A1 | Monthly | Internal / external | — |
| A5 | Tab: Year over Year by Service Type | Planning | A | Formula, checked against A1 | Monthly | Internal / external | Depends on ServiceType (Q15) |
| A6 | Tab: Chart Monthly Total | Planning | A | Formula + typed date | Monthly | Internal / external | Typed date |
| A7 | Tab: **Board total by service** | Planning | A | Typed subtitle, YTD totals and date | Monthly | **MVTA Board** | Hand-edited YTD; "by service" may mean ServiceType (Q15), *to verify* |
| B | **External monthly and quarterly reports** in Planning's *Reporting Tracker* | Planning | *to verify*, presumably workbook A | Separate how-to (*Monthly and Quarterly Ridership Reports_2025*) | Monthly / quarterly | Agencies, *to verify* | Not reviewed (#459 Q2) |
| C | **NTD ridership**: unlinked passenger trips (UPT), and passenger miles if any | Planning, *to verify* | *to verify*. The SOP draft marks NTD use as `[Decide]` | *to verify* | Monthly and annual | FTA | Unknown whether manual counts are treated as a 100% count, how uncounted trips are handled, and where passenger miles come from (#459 Q3–Q5) |
| D | **Met Council and other agency reports** | *to verify* | *to verify* | *to verify* | *to verify* | Met Council, others | Listed in tracker B, *to verify* |
| F | **Planning's crosstab, "Riders by Trip > Direction > Date"** (Access) | Planning | The Access `Riders` table | Open the crosstab → review → export to Excel | Monthly, before the roll-up | Planning (accuracy review) | One row per trip (Days, Route, Direction, TripID, `Vehtypgrp`, `MaxOfVariation`, `FirstOfTerm`, `LastOfStart`), one column per service date. Review is by eye; a blank cell can't be told apart as "not counted", "did not operate" or "not keyed yet" (#459 T7) |
| E | **Power BI** | — | — | — | — | — | **No ridership Power BI exists.** OnBoard's views in migrations 031 and 106 have no reader: there is no `mvta_reporting_ro` login, no gateway, and dev SQL public access is disabled |

## 2. Report review (Q1, Q9)

Before the report and Power BI build, Planning and Engineering hold **one
working session** on:

1. The latest monthly workbook (`.xlsx`, not the PDF).
2. The Reporting Tracker and the *Monthly and Quarterly Ridership Reports*
   how-to.
3. How NTD UPT (and passenger miles, if any) is produced today.

The output is the verified version of table 1.2: every tab and every report,
with its owner, source, steps, frequency, audience and problems. That verified
table is what the Power BI build (§5) is built from.

**The review does not gate the January export.** The export's shape is
already known: it is the `FixedTotals` paste.

## 3. Carry-over: what keeps working unchanged

From January 2027 OnBoard is the record. Its closed months feed the export,
and the workbook keeps working from it. **December 2026 is still an Access
month:** Planning closes and reports it from Access exactly as today, and its
`FixedTotals` rows reach OnBoard through the history import (§4.2). OnBoard's
December entries are Keolis training data, never the record, and are never
served as totals.

| Report | Carries over on the export? | What changes |
|---|---|---|
| F (trip × date crosstab) | **Replaced** by OnBoard's trip × date grid and its Excel export (§4.4) | Cells show status (Not counted / Did not operate) instead of blanks; rows carry the Access-style TripID |
| A (paste into *Raw – Rte Month*) | **Yes** | Rows come from OnBoard's export instead of the Access table. The 9 columns are in the same order |
| A1, A2, A4, A6 | **Yes** | — |
| A3 averages | **Yes** | Column J comes from the export's `ServiceDays` sheet instead of being typed (Q6) |
| A5 YoY by Service Type | **Blocked on Q15** | ServiceType is blank until Q15 is settled, so 2027 rows collapse the splits that history keeps apart |
| A7 Board total by service | **Yes, unless "by service" means ServiceType** (*to verify*); otherwise blocked on Q15 | YTD and "last revised" can come from the month log (§4.3) |
| "Last revised" dates on charts | Typed until Power BI takes over | Available as data from the month log |
| Connect and special-event rows | Still added by hand | Unchanged until v2 |
| B, C, D | Assumed yes, since they read workbook A | *To verify* in the review |

**Two definitions change on purpose (Q3).** Both are written into the
export's notes:

- **`Trips` = trips operated:** scheduled + added − did not operate.
  - Access appears to count every roster row, so DNO trips no longer inflate
    `Trips`.
- **`SumOfRiders` = counted boardings only. No expansion for Not counted
  trips.**
  - `AvgRiders` = riders ÷ counted trips.
  - Whether to expand riders for uncounted trips is a Planning/NTD question
    (§7).

**Day type** is the type of the GTFS service the trip ran under (Wk / Sat /
Sun / SpSat), not the calendar weekday. Special Saturdays and holidays use
the service-to-day-type mapping proposed at each service change and
confirmed by Planning (R4).

## 4. The export and the history

### 4.1 The `FixedTotals` export (Q2, Q6, Q7)

One Excel file per request, with three sheets:

| Sheet | Columns |
|---|---|
| `FixedTotals` | Exactly `FixedTotalsId, Date, Route, Direction, Days of Svc, ServiceType, Trips, SumOfRiders, AvgRiders`, in Access order. `FixedTotalsId` is a stable OnBoard key. `ServiceType` is blank until Q15 |
| `Detail` | The same keys plus `TripsScheduled, TripsAdded, TripsDNO, TripsNotCounted, TripsCounted, Riders, AvgRiders, MonthStatus` (R1) |
| `ServiceDays` | Month × day type → number of service days, from the GTFS calendar and the SpSat/holiday mapping (R5) |

- **Closed months by default.** A `ridership-manager` may export an open
  month. It is then stamped **PROVISIONAL** in the filename and in
  `MonthStatus`.
- **No operator names, in any sheet, for any role.**
- **Months follow the service date, not the clock date**, so the night
  across a month end stays in its service month (R12).

### 4.2 History (Q5)

- Access `FixedTotals` is imported as it is into its own table with
  `source = access`. It is never recomputed.
- **Timing:** the import that counts is taken **after Planning closes
  December 2026 in Access** (early January), so the history runs through
  December. A trial import of the Jan–Oct 2026 export can run earlier to
  prove the control totals.
- **Repeatable per month.** If the 18 Dec cutover notice is withheld and
  Access stays the record into 2027 (the briefing's fallback), each further
  Access month is imported the same way. A month is never held in both
  sources: OnBoard's totals start at the first month OnBoard is the record.
- A view unions the history with OnBoard's closed months, so one export or one
  chart covers the full history through the current month.
- **Acceptance:** rows, trips and riders per month in OnBoard equal the
  Access export, and ServiceType splits are kept (R7).

### 4.3 Month log

Closes, reopens and restatements already exist in the counting spec (§7,
the `OtpMonthlyRestatements` pattern). Reporting adds one thing:

- **A "Reported on" marker.** A ridership manager sets it on a month when its
  figures go out externally.
- A reopen of a reported month shows the marker and asks for the reason.
  Whether to revise the external submission stays a Planning decision (R9).

### 4.4 Trip × date grid (Planning's crosstab replacement)

Planning reviews a month from Access's "Riders by Trip > Direction > Date"
crosstab, not from monthly totals. OnBoard gives an equivalent:

- **On screen:** a tab in Ridership (manager and recorder, plus anyone with
  `ridership.view` for the name-free version) for one month and day type. One
  row per trip; one column per service date; each cell holds the boardings.
  A cell that is not a number shows why: **NC** (Not counted), **DNO** (Did
  not operate), **—** (no sheet entered yet) or blank (trip not scheduled
  that date). Flagged counts are marked, and a cell opens its Count Sheet.
- **Row keys:** day type, route, direction, scheduled start, GTFS `trip_id`,
  block, and the **Access-style TripID** (day type + route + direction +
  start HHMM, e.g. `243610748` = Sat, 436, N, 07:48; counting spec §16).
  Rows are matched across the month on route + direction + start + day type,
  so a `trip_id` change at a service change does not split a row. Added
  trips appear as their own rows, marked added.
- **Row totals and column totals,** with trips counted / not counted per
  column, so the grid balances against the `FixedTotals` export for the same
  month.
- **Excel export** of exactly what is on screen, one sheet per day type, with
  the same row keys. No operator names.
- **Scans:** where a sheet's scan is held (counting spec §15, PR #488), a
  cell also opens the scan, so a review checks the number against the page.
- **Delivery: Jan 1,** with month close: it is the screen Planning closes the
  month from, starting with January.
- **December comparison does not wait for it.** The 9–18 Dec comparison of
  Keolis's training entries with Access uses the build plan's daily totals CSV,
  which carries both trip IDs (build plan decision 6). Only the sheets Keolis
  keyed are compared, so the comparison is trip by trip on those sheets, not
  a month total.

## 5. Power BI through the reporting API (Q10, Q11, Q12)

The user's direction: review the existing reports, build on them, and **open
the API** so the information reaches Power BI.

**Access.**
- Read-only reporting endpoints under `/api/reporting/ridership/*`, separate
  from the console API.
- Function-level keys (`authLevel: "function"`), one key per consumer, kept
  in Key Vault and rotatable.
- Power BI connects with its *Web API* credential, using key name `code`.
  Service refresh needs **no gateway**.
- The key opens these routes and nothing else.
- The SQL-view path (031/106, which needs a login and a gateway VM) is not
  used for ridership.

**Feeds.** All four are JSON, filtered by month range. They are built on the
same module as the Excel export, so the two cannot disagree.

| Feed | Grain | Notes |
|---|---|---|
| Monthly totals | `FixedTotals` grain + `Detail` columns + `MonthStatus` | Closed months and imported history. Open months only with `provisional=true` |
| Service days | Month × day type | As the `ServiceDays` sheet |
| Trip counts | Service date × trip | Trip, block, garage, route, direction, day type, count status, boardings. **No operator name or ID, ever** |
| Month log | Month × event | Close, reopen, restatement, "Reported on". Gives charts a real "last revised" date |

**The charts move to Power BI, owned by Planning:**
- YoY by route
- average weekday and weekend
- monthly total
- the board total

The verified inventory (§2) is the build list. OnBoard does not build a PDF
report page unless Power BI is not adopted.

**What OnBoard keeps in the console:**
- the Excel export;
- a **Totals** tab with route → block → trip drill-down;
- a garage view;
- the operator view (§6).

## 6. Enhancements, prioritised

| Priority | Enhancement | Increment | Notes |
|---|---|---|---|
| 1 | `FixedTotals` export (3 sheets) | **Jan 1** | §4.1. The January close (by Feb 10) is the first one from OnBoard as the record |
| 1a | Trip × date grid with Excel export | **Jan 1** | §4.4. Replaces Planning's Access crosstab; the screen month close is reviewed from |
| 2 | History import with control totals | **Jan 1** | §4.2. Needs Planning's full Access export |
| 3 | Reporting API: monthly totals, service days and month log, plus the function key | **Jan 1** | §5 |
| 4 | Report review with Planning | **Before early Feb** | §2. Produces the Power BI build list |
| 5 | Trip-counts feed, and the console Totals tab with route → block → trip drill-down | **Early Feb** | — |
| 6 | Garage view (console and API) | **Early Feb** | A garage is not personal data. Uses `RidershipBlockGarages` |
| 7 | "Reported on" marker | **Early Feb** | §4.3, R9 |
| 8 | Planning's first Power BI ridership report | **Early Feb** | Built from §2, on the feeds in §5 |
| 9 | Operator view | **Early Feb** | **Console only**, for recorder, manager and compliance (Q17). Never in the API, Power BI or the export |
| 10 | Productivity: riders per trip and **riders per scheduled trip-hour** | **v2** | Hours from `TripStartLog` scheduled start→end (migration 153), which is running time without layover or deadhead. Not to be labelled "revenue hours" until Planning names the hours its reports use (Q14) |
| 11 | Avail APC overlay | **v2** | Manager-only, in the console, built on counting spec §12's comparison (the 2026-10-28 sample ran about 16% above manual). **Kept out of the Power BI feeds** until APC is validated (Q15) |
| 12 | Connect ridership in the totals | **v2** | Not designed (Q15 of the counting spec stays open). Added by hand until then |
| 13 | Automatic NTD figures | **v2** | Gated on §7 Q3–Q5. Until then OnBoard provides only monthly fixed-route boardings with not-counted trips shown, not "NTD-ready" UPT. A per-trip total cannot give passenger miles (Q16) |
| — | OnBoard PDF report page | Only if Power BI is not adopted | Q12 |

**The 7 December start adds nothing for reporting.** The daily totals CSV
used for the December comparison is already in the build plan (PR 3). The
first month OnBoard closes is January 2027 (by 10 Feb), so everything marked
Jan 1 must be ready for that close, not for 1 January itself.

### Steps outside the code (numbered, owner in brackets)

1. Send the latest workbook (`.xlsx`), the Reporting Tracker and the
   external-report how-to, and hold the report review (§2). [Planning]
2. Export the full Access `FixedTotals` table for the history import, **after
   closing December 2026 in Access**. This is the same as counting spec §11
   step 4. A Jan–Oct trial export already exists. [Planning]
3. Create the Power BI function key in Key Vault and give it to the Power BI
   dataset owner. Record who holds it. [Engineering + Planning]
4. Build the first Power BI ridership report on the feeds. [Planning]
5. Confirm the SpSat/holiday day-type mapping at each service change (R4).
   [Planning]

## 7. Open questions for Planning

1. **The files.** The latest workbook, the Reporting Tracker and the
   *Monthly and Quarterly Ridership Reports* how-to (§2).
2. **External reports.** Which reports does the tracker list (board, Met
   Council, NTD, others)? For each: which figures, deadline and recipient,
   and does it use the closed month or a later revision?
3. **NTD UPT.** Is fixed-route UPT reported from these manual counts as a
   100% count? How are uncounted trips handled?
4. **Expansion.** Should OnBoard estimate riders for Not counted trips, shown
   apart from counted riders, or stay counted-only (§3)?
5. **Passenger miles.** How are they produced today, if at all? Do they wait
   for validated APC?
6. **"Board total by service".** Does "service" mean ServiceType (blocked on
   Q15) or something else?
7. **Hours.** Which hours do productivity figures use today, if any: Optibus
   revenue hours, platform hours, or none?
8. **Charts in Power BI.** Who in Planning owns the Power BI dataset and the
   key, and is the PDF of the green tabs still needed once the charts live in
   Power BI?
9. **ServiceType (Q15) and Connect (v2).** These are unchanged here. A5, and
   possibly A7, wait on Q15. **Possible source:** the crosstab's `Vehtypgrp`
   (seen: R), `MaxOfVariation` (seen: blank) and `FirstOfTerm` (seen: S) —
   what does each mean, and is one of them ServiceType?
10. **Access TripID.** Which day-type digits do Sunday and Special Saturday
    use, how is a route that isn't three digits written, and is direction
    always N/E = 1 and S/W = 2 (counting spec §16)? The grid's TripID column
    depends on it.

## Decision log (2026-11-01)

| Q | Decision |
|---|---|
| Q1 | Write the inventory now from the procedure docs and mark the rest *to verify* |
| Q2 | Export = `FixedTotals` (exact 9 columns) + `Detail` sheets |
| Q3 | `Trips` = operated; riders counted only, no expansion; average over counted trips |
| Q4 | Tabs cut by ServiceType are blocked on Q15; nothing else waits |
| Q5 | History kept as-is in its own table, unioned by a view; control totals before acceptance |
| Q6 | `ServiceDays` sheet replaces typed column J |
| Q7 | Closed months by default; open months only as PROVISIONAL, by a manager |
| Q8 → Q17 | No names in Power BI, the API or the export; operator view console-only |
| Q9 | The report review gates the Power BI build, not the January export |
| Q10 | Power BI uses function-key reporting endpoints; no gateway |
| Q11 | Four feeds (monthly totals, service days, trip counts, month log) on the export's module |
| Q12 | Charts and the board report move to Power BI; OnBoard keeps the export, drill-down and operator view |
| Q13 | Increments as §6 |
| Q14 | Riders per scheduled trip-hour, not "revenue hour"; v2 |
| Q15 | APC overlay v2, manager-only, kept out of Power BI until validated |
| Q16 | NTD figures v2, gated on Planning's answers |
| Added 2026-11-03 | Plan A: December stays an Access month; history import taken after December's Access close and repeatable if cutover slips; December comparison uses the daily CSV, not the grid |
| Added 2026-11-02 | Trip × date grid + Excel export (replacing the Access crosstab), Jan 1, rows carry the Access TripID |
