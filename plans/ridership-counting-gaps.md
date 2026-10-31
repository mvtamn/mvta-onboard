# Ridership Counting — Gaps Record

Date: 2026-10-30. **Not implemented.** A record of the gaps found reviewing the
current fixed-route ridership process, kept so they are closed before the
procedure goes to Keolis (service starts 2027-01-01) and before anything is
built in OnBoard.

Inputs (the `ridership/` folder in the main checkout — **not in git**; the
Connect export holds rider addresses, coordinates, comments and driver names):

- `RidershipDB_UpdatingRidershipDatabase_202603.docx` — Planning's monthly
  roster build (Optibus → Excel → Access)
- `RidershipReport_UpdatingRidershipReport_202603.docx` — Planning's month
  close and report
- A scanned Passenger Count Sheet (one total per trip, by time range)
- Screenshots of the Access "Recent Riders SST DATA ENTRY" table and the
  "Ridership Data Manager" menu
- `FixRoute_Ridership-Count-Jan to Oct 2026.csv` — `FixedTotals`, Jan–Sep 2026
- `Connect_Ridership-Count-Jan to Oct 2026.csv` — Spare trip export, Jan–Oct
- `SOP_OPR-038-00` — General Bus Operations, "Ridership Counting and Count
  Sheet Submission"
- The 2026-10-23 → 10-30 "Ridership Database Procedures" email thread

## The process today

1. **Roster (Planning, monthly or each service change).** Optibus trip
   properties and vehicle schedules, one export per service type, are pasted
   through "1. Vehicle Schedule" and "2. Riders Base" workbooks into
   `Riders_FINAL`, one copy per day chosen by day type, then imported into the
   Access data-entry backend.
2. **Count (Operator).** One total per trip on a paper Count Sheet, handed in at
   check-in.
3. **Entry (SST OCC).** Sheets collected and keyed into an Access form 2–3
   times a day.
4. **Close (Planning, monthly).** Blanks and large values found by sorting;
   suspect trips emailed to SST; append queries archive the month and roll it
   into `FixedTotals`.
5. **Report (Planning, monthly).** `FixedTotals` pasted into last month's Excel
   workbook; day counts typed from the service calendar; Connect and special
   events added from separate files; PDF exported.

## The contract obligation

The operations contract (not Attachment G) requires that Operators conduct
passenger counts on all trips in accordance with MVTA's procedures and
standards, and record them accurately and in a timely manner. The Contractor
must train, supervise and monitor its employees and ensure the ridership
counting and reporting procedures **provided by MVTA** are implemented and
consistently followed.

So the obligation is only as precise as the procedure MVTA hands over, and it
has three measurable parts: **completeness** (all trips), **accuracy**, and
**timeliness**.

## Gaps

### Contract and procedure

| # | Gap | Why it matters | Owner to decide |
|---|---|---|---|
| C1 | **The SOP and the Count Sheet disagree.** OPR-038 says record boardings *and alightings* *at each timepoint*; the sheet collects one boardings total per trip. | The contract binds Keolis to "MVTA's procedures"; two conflicting MVTA documents leave the standard open to dispute. | Planning + Operations: pick one and amend the other. |
| C2 | **"Timely" has no standard.** Today it is "OCC checks 2–3 times a day." | Timeliness cannot be held to without a number (e.g. sheet at pull-in, entered by end of next service day). | Operations |
| C3 | **"Accurately" has no test.** Planning's check is to sort and look. | Accuracy cannot be held to without a written rule (e.g. blank on a trip that ran; count over N× the trip's recent average). | Planning |
| C4 | **No enforcement path.** Attachment G has no ridership KPI or penalty. | The obligation can be reported but not assessed through the Contractor Performance Assessment. | MVTA: whether to amend. |
| C5 | **No written procedure exists yet for Keolis.** The two Planning docs cover MVTA's side; the operator → check-in → OCC entry flow is only in the email thread. | The contract makes MVTA responsible for providing it. Draft requested for early week of 2026-11-02. | Planning + Operations |
| C6 | **Count Sheet retention** is stated only in email ("until monthly ridership is closed out"). | Belongs in the written procedure. | Planning |
| C7 | **Special-event counts** go to Planning on paper "unless completed digitally" — no rule for which. | Part of "all trips." | Planning |
| C8 | **APC.** OPR-038 allows APC to replace the sheet when the Garage Manager confirms it is sufficient — no criteria for "sufficient," and it is unknown which vehicles have working APC. | Decides whether paper can be retired anywhere. | Operations |

### Process

| # | Gap |
|---|---|
| P1 | The roster is rebuilt by copy/paste every month from Optibus, per service type, per day. |
| P2 | Every count is recorded twice by hand: written on paper, then keyed into Access. |
| P3 | Known silent-failure steps in the procedure itself: leftover rows from a previous pick; day type and day counts typed by hand; the `'000'` block format must be the last step or the import breaks; answering "Yes" to "save design changes" damages the Access file. |
| P4 | Close-out validation is by eye, with no expected range, no week-over-week comparison, and no list of trips that ran without a count. |
| P5 | Single-person knowledge: `M:`/`O:` paths, the shift-open backend trick, named Access queries. |
| P6 | Corrections are requested by email with no record of what was flagged, changed, or by whom. |
| P7 | The month close records no who/when; the report's "last revised" dates are typed on each chart. |

### Data quality

| # | Gap |
|---|---|
| D1 | Rows in the Access entry table can have a blank `TripID` (seen on Route 495), so trips are matched by block and time, not a stable key. |
| D2 | The Count Sheet carries no trip ID or direction — only route and a time range — so OCC matches each line to a trip by hand. |
| D3 | September 2026 fixed-route ridership is 123,618 vs 97,449 in August (+27%) on flat trip counts. Unconfirmed whether real (e.g. school service) or an entry problem. |
| D4 | The Connect export is completed trips only (cancellations and no-shows filtered by the query); riders are the sum of 11 fare-category columns (AP–AZ). The counting rule is undocumented. |
| D5 | Connect timestamps are UTC; bucketing by UTC month moves late-evening trips at month end into the next month. Needs Central service date. |
| D6 | `ServiceType` codes (L/MX/RC/SX/DX) and `Days of Svc` (Wk/Sat/Sun) are undefined anywhere OnBoard can see. They need `CONTEXT.md` entries before anything is built on them. |

### Data handling

| # | Gap |
|---|---|
| H1 | The Connect export (240 MB, rider PII) was sent by email/file share, and sits untracked but not git-ignored in the main checkout. |
| H2 | Count Sheets carry operator name and ID; no handling rule beyond retention. |

## Proposed direction (draft, pending enhancement details)

- Operators (or OCC, from the sheet) enter counts in OnBoard against the
  Dispatch Log trip instead of in Access. The Dispatch Log already writes one
  row per revenue trip per service date with the Block in `001` form
  (`tripStartLogMaterialize`), which removes P1, D1 and D2.
- A completeness view shows trips that ran but have no count, by garage and
  day (C2, P4).
- Outlier checks compare each trip with the same trip on recent weeks (C3, P4).
- A monthly close records who closed it and when; the `FixedTotals`-equivalent
  and the report are generated from it (P6, P7), following the settled-month
  pattern of ADR 0033/0039.
- Connect comes in automatically, bucketed by Central service date (D4, D5;
  see `plans/onboard-spare-integration-spec.md` §8).
- APC replaces paper where it is installed and working (C8) — availability to
  be confirmed.
