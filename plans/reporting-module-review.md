# Reporting module review

Status: review, 2026-11-04 (main at a9640fca). No code changed.
Purpose: list the reporting OnBoard already does, and find where a reporting
module would help: shared tools rather than one more page.

## 1. What exists today

### Report-like surfaces, by domain

| Domain | Backend | Console | Export / print | External feed |
|---|---|---|---|---|
| OTP | `otpMonthly.ts`, `otpMonthlyTrend.ts`, `otpDaily.ts`, `otpAuditStream.ts` (logic in `lib/otpMonth/`) | Compliance › OTP: Dashboard, Review Queue, Route Summary, Weather, Monthly, Audit | none | views `vw_OtpMonthlyRouteStop`, `vw_OtpDailyRouteStopHour`, `vw_OtpRestatement`, `vw_OtpMeasurement*` (mig 106/140/141/151/152), with **no reader** |
| Performance Assessment | `assessmentReports.ts` → `lib/report/buildReportModel.ts` → `renderAssessmentReport.ts` | `/performance-assessment/*` (Scorecard … Issuance, History) | archived HTML, SHA-256 checked, browser print-to-PDF | `vw_Scorecard*` (mig 031/032b), **no reader** |
| Missed trips | `missedTripsMonthlySummary.ts`, detector scorecard | Compliance › Missed Trips (month × route pivot), Admin › Detectors | none | `vw_MissedTrip` (defined in 106, then redefined in 125, 135 and 137) |
| Garage departures | `/fixed-route-departures`, `/on-demand-departures` | Compliance › Garage Departures | none | `vw_GarageDeparture` (has `OperatorName`), `vw_MeasurementFeedHealth` |
| Dispatch Log | `tripStartLogExport.ts` + `lib/tripStartLogCsv.ts` | Service Ops › Dispatch Log | server CSV, always the whole day | none |
| Detours | `GET /detours` only | Detour Register | **client** CSV + HTML print page (`lib/detourSearch.ts`) | none |
| Ridership | `/ridership/worklist`, `/ridership/print` (pdfkit) | `/ridership`, completeness by garage, Print Sheets | Count Sheet PDF | `/api/reporting/ridership/*` spec'd in PR #475, not built |
| Schedule review | `gtfsPredictionRisk.ts`, `lib/scheduleReview/*` | `/schedule-review` | none | none |
| Prediction accuracy | `predictionScore` timer writes `PredictionAccuracyDays` | **none** | none | **no read endpoint at all** |
| Access / audit | ~10 separate audit/history feeds | Access activity, Governance audit | client CSV of the Entra inventory (formula-safe) | none |
| Subscribers, KPI trust, feed health | summary endpoints | stat cards, health pages | none | none |

### What is shared: almost nothing

- **Nav:** there is no Reports section. Reports are spread across Service
  Operations, Specialist Operations, Compliance & Assessment and five admin
  areas. Sub-tabs (OTP, Assessment, Compliance) are `useState`, so a report
  view cannot be linked or bookmarked. Schedule Review (`?route=`) is the one
  exception.
- **Export:** three CSV writers that don't share code. Backend
  `tripStartLogCsv.csvCell`; frontend `detourSearch.csvCell`/`downloadCsv`
  (BOM + CRLF, **no formula-injection guard**); and `ExportInventoryButton`
  (guarded, but no BOM and LF line endings). There are five hand-written
  Blob→anchor download blocks, no XLSX anywhere, and no general export endpoint.
- **Renderers:** three unrelated ones. The assessment report is an HTML string,
  Count Sheets are pdfkit, and the dispatch email has its own HTML.
- **Periods:** the backend has three YYYYMMDD validators and about five month
  helpers (`serviceMonthOf`, `serviceMonthOfDate`, `keyToDate`, `monthBoundary`,
  `businessDays`), and each handler parses its own date range. The console has
  no shared month or date-range picker, and `formatServiceMonth` is defined twice.
- **Tables / charts / print:** `SortableTable` exists but only Dispatch Log uses
  it, so about 15 pages hand-write `<table class="data">`. There is no chart
  library; every chart is CSS divs. There is no `@media print` anywhere in the
  console. There are three or more empty-state patterns.
- **Delivery:** no scheduled digests, no report emails or Teams posts, and no
  record of which figures went to whom. The one exception is the assessment
  issuance record.
- **Power BI:** about 20 views exist, but there is no `mvta_reporting_ro` login,
  no gateway and no function-key API, so **nothing outside the console can
  read any figure today**. The ridership spec (PR #475, Q10) already rejected
  the gateway path for ridership in favour of function-key endpoints.

### Decisions already made (keep these)

- Power BI is the chart and board-report layer, owned by Planning. OnBoard
  keeps exports, drill-down and the operator view (PR #475 Q12).
- No view or feed re-implements a judgement. Feeds publish `IsAssessable` and
  the occurrence; they do not filter (mig 106).
- Every OTP figure is stamped with its measurement parameters (ADR 0042), and
  restatements are recorded (ADR 0039).
- No operator names in Power BI, the API or any export (PR #475 Q8/Q17). This
  conflicts with `vw_GarageDeparture.OperatorName`; see 3.4.
- Issued reports are frozen, hashed artifacts with lineage (ADR 0006, 0013, 0029).

## 2. Unmet reporting needs (from specs, SOPs, issues)

- **Planning's monthly ridership workbook and Board totals.** About ten steps are
  done by hand each month (paste FixedTotals, type day counts, type the "last
  revised" date, type Board YTD), and the Access crosstab is reviewed by eye.
  See PR #475 §1.2.
- **External / Met Council / NTD reports.** Recipients, deadlines and how UPT is
  produced are all unknown until Planning's Reporting Tracker review.
- **Month-close checks.** There is no route-month swing check (September's
  +27% passed); Reporting Failure proposals; contractor completeness and
  timeliness by garage (SOP 02).
- **OTP.** Weather days are missing from the assessment report model (closeout
  Q9). The Avail canned monthly report still has to be produced for May, June
  and August.
- **Detours.** An Operations-friendly report (#66, #83). The `*_emailed` flags and
  the Excel tracker are kept by hand.
- **Governance.** Procedure and Decision Matrix reporting (#25,
  `SUGGESTED_IMPROVEMENTS.md` §13.4). Scorecard export and high-exclusion-rate
  flags (§14.6) are not built.

## 3. Opportunities, ranked

The rank is by how much later work each one unblocks, not by size.

### 3.1 One reporting API for outside readers (the module's seam)

Take PR #475's ridership decision and make it the general path:
`/api/reporting/{domain}/*`. It is read-only, uses function keys (one key per
consumer, in Key Vault), and serves the **same module the console and the
exports read**, so Power BI can never disagree with OnBoard.
- First feeds: `otp/monthly` (figure plus its parameter stamp and any
  restatement), `missed-trips/monthly`, `garage-departures/daily`,
  `assessment/scorecard` (finalized periods only), then `ridership/*` as specced.
- Every response carries `asOf`, `period`, `isProvisional`/`isClosed`, and
  `parameters` where they apply. A reporting reader then never has to know
  which months are final.
- This makes the gateway, the `mvta_reporting_ro` login and most of the 031/106
  views unnecessary. Retiring them, or keeping them for ad-hoc SQL, is a
  decision for the user (see 4).
- No feeds exist yet, so this is the cheapest time to set the contract.

### 3.2 One export module (server-side)

`lib/export/`: a table definition (columns, formatters, sheet name) rendered
to CSV or XLSX. CSV gets BOM, CRLF, quoting and the formula-injection guard
**together**. XLSX can hold several sheets.
- Ridership's three-sheet FixedTotals workbook needs XLSX anyway. Build this
  first and that work rides on it.
- Move the Detour and Access CSVs to the server so every export is audited and
  matches the API.
- Add exports where they are missing and wanted: OTP month (route × stop),
  missed-trips month, garage departures, the audit log with a date range, the
  scorecard with its supporting detail (§14.6).
- Print is part of this too: one console `@media print` sheet, and one HTML
  report shell reused from `renderAssessmentReport.ts`.

### 3.3 One period model

Backend: `lib/period/`, which parses and validates service date, service
month, range and closed/provisional state in one place. It replaces three
validators and five month helpers, and every handler's own range parsing.
Console: one `PeriodPicker` (day / month / range, with a stepper) and one
`formatServiceMonth`.
It is small and dull, but 3.1 and 3.2 both need it, or each feed will invent
its own month rules again.

### 3.4 Small defects found along the way

- `lib/detourSearch.ts` CSV has **no formula-injection guard**. A detour field
  starting with `=`, `+`, `-` or `@` runs as a formula when opened in Excel.
  This is a one-file fix, or it disappears with 3.2.
- `storage-compliance-reports.bicep` has **no immutability (WORM) policy**, yet
  the archived HTML is called the official record. The hash check finds
  tampering; it does not prevent it.
- `vw_GarageDeparture.OperatorName` cuts against the "no operator names in
  Power BI" rule from PR #475. One of the two needs to change.
- Prediction accuracy is scored every night and **cannot be read**: there is no
  endpoint and no page.

### 3.5 A Reports area in the console

Add a "Reports" sidebar section listing each report: what it covers, its
period, who owns it, its formats, when it was last refreshed, and a link to
its drill-down page. Make report sub-tabs real URLs so a figure can be linked.
This is mostly reorganisation once 3.1–3.3 exist; before then it would only
list pages with nothing to export.

### 3.6 Month close packet and report log

- **Month close packet:** one issued artifact per service month. It holds the OTP
  month, missed trips, garage departures and ridership completeness, with
  swing checks (for example route-month ±X%) and the Reporting Failure
  proposals. Build it on the assessment report's archive, hash and lineage
  code, which is the one part already done well.
- **Report log:** a record of each figure that left OnBoard: what, which
  period, which parameters, to whom, and when. This generalises the
  assessment issuance record and the "Reported on" marker in PR #475. It also
  answers "do we need to restate?" (ADR 0039).
- **Scheduled delivery:** report emails and Teams posts can follow later, using
  the ACS and Workflows paths that already exist.

### 3.7 Not recommended now

- **A chart library in the console.** Power BI is the chart layer by decision,
  and the hand-built bars cover the drill-down pages. Revisit only if Power BI
  is not adopted (PR #475 Q12).
- **A generic report builder or ad-hoc query tool.** No user asks for one, and it
  works against "no view re-implements a judgement".

## 4. Decisions for the user

1. Is the function-key reporting API the path for **every** domain, retiring
   the SQL gateway plan for the 031/106 views? Or do the views stay for ad-hoc SQL?
2. Should the first reporting feed be ridership (deadline Jan 1, already
   specced) or OTP (already settled, and Rob's audience)?
3. Should operator names come out of `vw_GarageDeparture`, or should the "no
   names" rule be limited to ridership?
4. Should immutability on the compliance-reports container be part of this
   work or tracked separately?

## Suggested order

3.4 detour CSV guard (tiny) → 3.3 period model → 3.2 export module, with XLSX
for ridership FixedTotals → 3.1 reporting API (ridership feeds first, then
OTP / missed trips / garage / scorecard) → 3.6 report log → 3.5 Reports nav
→ 3.6 month-close packet once Planning's report review has been held.
