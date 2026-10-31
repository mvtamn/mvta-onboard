# Ridership Counting — Spec

Date: 2026-10-30. **Not implemented.** Decisions agreed with the user in a
grilling session on 2026-10-30, after the review recorded in
`plans/ridership-counting-gaps.md`. Gap IDs (C1, P4, D2 …) refer to that file.

Replaces the Access ridership database (`Ridership Data Entry_be.mdb` /
`Ridership Data Manager.mdb`) for fixed-route ridership, in time for the new
operations contractor (Keolis) starting 2027-01-01. The draft procedure for the
contractor is `plans/ridership-counting-procedure-draft.md`.

## The obligation this serves

The operations contract requires Operators to count passengers on all trips in
accordance with MVTA's procedures and standards, accurately and in a timely
manner, and makes the Contractor responsible for training, supervising and
monitoring so that MVTA's ridership procedures are followed. This spec gives
each of those words a measurable rule:

| Contract word | Rule here |
|---|---|
| all trips | Completeness (§5) |
| timely | Entered by end of the next calendar day (§5) |
| accurately | Outlier flags answered by month close (§6) |
| MVTA's procedures | The procedure draft, plus OPR-038 amended (§2) |

## 1. Scope

- **v1: fixed route.**
- **v2: MVTA Connect** from the Spare Ridership Export, bucketed by Central
  service date (D4, D5). Not designed here; the export returned HTTP 503 on the
  last probe (`plans/onboard-spare-integration-spec.md` §8).
- **Later: special events.** Event Plans do not schedule trips, so there is no
  Dispatch Log row to count against (C7).

## 2. The count

- **Unit:** one boardings total per trip. OPR-038's "boardings and alightings
  at each timepoint" is amended to match (C1). Per-stop detail is APC's job,
  if and where APC exists (C8 stays open with Operations).
- **Count Sheet:** one per **block per service date**. At MVTA a block is a
  run (one operator's assignment), so this is also one operator's sheet.
- **Trips on a sheet:** the block's revenue trips from the Dispatch Log
  (`TripStartLog`, one row per revenue trip per service date, Block in `001`
  form). This replaces the Optibus → Excel → `Riders_FINAL` roster build
  entirely (P1, P3, D1).

## 3. Count Sheet printing

- OnBoard produces the **next service date's** sheets overnight, after
  `tripStartLogMaterialize` has written the day: one page per block, listing
  each trip's route, direction, scheduled start/end and trip ID (plus a QR
  code identifying the block and date) (D2).
- Operators are assigned in real time just before pull-out, so the **operator
  and bus are left blank** for the operator to write in. When operators are
  pre-assigned in future, the name prints on the sheet.
- Sheets are printed by the contractor at each garage from OnBoard.

## 4. Entry

- **v1: contractor OCC staff** key sheets in OnBoard, replacing the Access form.
  **Later: operators** enter their own counts (e.g. by scanning the sheet's QR
  code at check-in), once v1 is proven.
- **Entry screen** mirrors the sheet: pick service date + block → the block's
  trips in order → a total per trip.
- **Operator name, operator ID and bus** are pre-filled from Avail's pull-out
  report (`FixedRouteDepartures`, keyed service date + block + run, holding
  who actually logged in and on which vehicle). OCC overrides when the sheet
  differs (relief, swap, bus change); the override is recorded and the
  handwritten value wins.
- **Unscheduled trips** (extra service, trippers, OCC-added trips): OCC adds the
  trip to the block with route, direction, start time and a reason, and enters
  its count. Included in totals, marked as added.
- **Lost or damaged sheets:** counts reconstructed per OPR-038 are entered
  marked **reconstructed**. Not an occurrence if on time; the reconstructed rate
  is reported by garage and operator.
- Every entry and change records who and when (P6).

## 5. Completeness and timeliness

- **A count is required** for every scheduled revenue trip, **unless** a
  missed-trip case confirms it missed or canceled. Trips whose Dispatch Log
  status is `unknown` still need a count.
- **Late:** not entered by the end of the calendar day after the service date
  (Central time).
- **Completeness view:** trips that need a count and have none, and counts
  entered late, by **garage** and service date, drilling to block.
- **Garage** comes from a **block-to-garage list Planning maintains** in OnBoard
  each service change. Blocks with no garage show as "Unassigned" so the gap is
  visible rather than silent.

## 6. Accuracy — outlier flags

- A trip's count is compared with the **same trip** (route, direction,
  scheduled start, day type) over the **previous 4 weeks**.
- **Flag** when the count is **> 3 × the median and at least 10 above it**, or
  is **0 when the median is ≥ 5**. All three numbers are settings, not code.
- A flag goes to the contractor, who either **corrects** the count or
  **confirms** it with a note. A flag is a question, not a finding.
- Planning (ridership manager) can also raise a flag on any trip by hand.

## 7. Month close

1. **By the 5th** of the following month the contractor has answered every
   flag and **marks the month complete** (who/when recorded).
2. **By the 10th** Planning **closes** the month (who/when recorded). The
   closed month produces the monthly totals (§9).
3. **Reopen:** only a ridership manager, with a reason. Any change to a closed
   month's totals is recorded with previous value, new value, who and why —
   the same pattern as `OtpMonthlyRestatements` (ADR 0039).

## 8. Compliance — occurrences

- Failures feed the existing Attachment G occurrence penalty **Incident and
  Data Reporting** (`INCIDENT_REPORTING`, $500 per incident; CAP after 3+ in
  30 days).
- **One occurrence per Count Sheet** (block + service date) that is any of:
  missing, entered late, or carrying a flag still unanswered at month close.
  A reconstructed sheet entered on time is not an occurrence.
- At close, OnBoard proposes **candidate occurrences** with their evidence; the
  **compliance manager confirms** each before it reaches the assessment. That
  confirmation is the management review Attachment G requires before a
  penalty.
- **Paper sheets are retained** by the contractor until the month's Assessment
  Period is final and its dispute window has passed (C6).

## 9. Day types, totals and reporting

- **Day type** (Wk / Sat / Sun / SpSat) is the type of the GTFS service the trip
  ran under, not the calendar weekday: a holiday on a Sunday schedule is Sun.
- **Monthly totals** are the replacement for `FixedTotals`: per month, route,
  direction, day type and service type → trips, riders, average.
- **First:** a totals export shaped like `FixedTotals` so Planning's existing
  workbook keeps working. **Later:** an OnBoard report page with PDF/Excel
  export replaces the workbook (P7).
- **History:** the full Access `FixedTotals` history is imported once, so every
  year-over-year chart can be rebuilt. Needs an export of the whole table from
  Access.

## 10. Roles and visibility

Two new app-owned roles (ADR 0032):

| Role | Held by | Can |
|---|---|---|
| `ridership-recorder` | Contractor OCC staff | Enter and correct counts, add unscheduled trips, answer flags, mark a month complete, print sheets |
| `ridership-manager` | MVTA Planning | Everything a recorder can, plus raise flags, maintain the block-to-garage list, close and reopen months, edit settings |

**Operator names** are visible only to `ridership-recorder`,
`ridership-manager` and the compliance roles; other viewers and their exports
see totals without names.

## 11. Delivery

| By | Increment |
|---|---|
| **2026-12-01** | Block-to-garage list; overnight Count Sheet printing; OCC entry with Avail pre-fill, unscheduled trips and reconstructed flag; completeness and lateness view; the two roles |
| **2027-01-01** | Outlier flags and answers; month complete + close + reopen with restatements; monthly totals export; `FixedTotals` history import |
| **Early Feb 2027** (January close) | Candidate occurrences → compliance manager confirmation → `INCIDENT_REPORTING` |
| **v2** | Connect; OnBoard report page; operator self-entry |

**Cutover:** December 2026 is keyed in **both** Access and OnBoard; Access is
the record for December, and Planning compares December's totals across the
two. From January 2027 OnBoard is the only record and Access is frozen.

### Steps outside the code (numbered, owner in brackets)

1. Seed `ridership-recorder` and `ridership-manager` in the app-owned roles
   table and assign Planning staff to `ridership-manager`. [Engineering + an
   access administrator]
2. Create Entra B2B guest accounts for Keolis OCC staff (Guest Sponsorship) and
   assign them `ridership-recorder` in OnBoard before 2026-12-01. [MVTA IT +
   Operations]
3. Enter the block-to-garage list for the current service change. [Planning]
4. Export the full `FixedTotals` table from Access. [Planning]
5. Amend OPR-038 "Ridership Counting and Count Sheet Submission" to a per-trip
   boardings total, the next-day entry deadline and the sheet retention rule.
   [Planning + Operations]
6. Review and issue the contractor procedure
   (`plans/ridership-counting-procedure-draft.md`). [Planning + Operations]

## 12. Future — comparison with Avail passenger counting (APC)

Added 2026-10-30 at the user's request. Not decided; the comparison screen is
mocked in the prototype (`?prototype=ridership`, "Compare with Avail APC").

**What exists today.** No passenger-count data reaches OnBoard. The Avail360
endpoints OnBoard calls (`lib/availClient.ts`: AVL, pull-out, OTP daily and
monthly, missed trips, detours) carry no boardings or alightings. The only
related signal is GTFS-RT VehiclePosition `occupancy_status`, a live load band
overwritten each poll, not a count.

**What the comparison would do,** once per-trip APC boardings arrive:

- Match each manual count to the APC figure for the same trip (trip ID,
  block, service date) on buses whose counter is reporting healthy; exclude
  trips where the counter faulted.
- Show **agreement** (share of trips within ±N %) and the day's manual vs APC
  totals on comparable trips.
- Show the **APC ÷ manual ratio by bus**, and later by operator: a steady gap
  on one bus points at the counter; a gap that follows one operator across
  buses points at the sheets.

**What it is for:**

1. **Accuracy evidence.** An APC figure beside a flagged count lets the
   contractor and Planning settle a flag on evidence rather than judgement
   (§6).
2. **Retiring paper (C8).** OPR-038 lets APC replace the sheet when the Garage
   Manager confirms it is sufficient. The comparison gives "sufficient" a
   test, e.g. a bus or route whose APC agrees within an agreed tolerance for
   an agreed number of weeks.
3. **NTD.** Using APC for NTD ridership requires validating it against
   manual counts; the manual counts collected here are that sample.

**The Avail360 report (data definition received 2026-10-30).** Avail has an
APC report: *APC Ridership By Service Level, Block, Route, Trip, Timepoint*,
boards and alights by service level, block, route, trip, timepoint and
direction.

- `GET {base}/ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1/{Property}`
  (the definition shows the test host `avail360-test.myavail.cloud` and
  property `ACME`; MVTA's is `MVTA` in `lib/availClient.ts`). The production
  endpoint is coming from the user.
- Query: `ReportStartDate`, `ReportEndDate` (both **YYYY-MM-DD**, unlike the
  OTP and missed-trip endpoints' MM-DD-YYYY), optional comma-separated
  `ServiceLevelFilter`, `BlockFilter`, `RouteFilter`, `TripFilter`
  (**Farebox IDs**), `PropertyNameFilter`.
- Auth: `Ocp-Apim-Subscription-Key` header, the same scheme as the other
  Avail360 endpoints; whether MVTA's existing key covers this API is to
  confirm.
- **The response schema is empty in the definition.** Field names, one row
  per timepoint or per trip, and whether a vehicle or counter-health field is
  present all need a sample response.

How it fits OnBoard:

- It would be a seventh endpoint on `lib/availClient.ts` (`apc_ridership`),
  polled nightly for the previous service date.
- **Matching keys.** `RouteFareboxID` in the OTP feed is the plain route number
  (446), so Block and Route Farebox IDs should line up with the Dispatch Log's
  Block and route. **Whether a Trip Farebox ID maps to the GTFS `trip_id` the
  Dispatch Log uses is the main open question**; if not, the match falls back
  to block + route + direction + scheduled start.
- **Per trip,** APC boards = the sum of the trip's timepoint boards; that is the
  figure compared with the manual count. Timepoint boards/alights are kept for
  drill-down and are the per-stop detail OPR-038's original wording asked
  for.
- **Service level** (e.g. Weekday) should correspond to the Day type in §9.
- The prototype's APC tab is shaped on this report, with assumed field names.

**Questions still for Avail:**

- Which MVTA vehicles have APC, and is the APC module licensed for MVTA?
- A sample response for one day, and the field list.
- Trip Farebox ID vs GTFS `trip_id`.
- How soon after a trip the data is available, and how a faulty counter
  shows up (missing rows, zeros, or a flag).
- Whether MVTA's APC data is certified for NTD reporting.

**Decisions for later,** once the answers are in: the tolerance and number of
weeks that let a bus or route drop the paper sheet; and which figure is the
record for a trip that has both.

## 13. Future — operator mobile app

Added 2026-10-30 at the user's request; the later stage of Q1 ("operators enter
their own counts once v1 is proven"). Mocked in the prototype as "Operator
mobile". Not decided.

- **No scanning.** The app knows the operator's block from their Avail login
  (`FixedRouteDepartures`), the same source the OCC screen pre-fills from;
  the sheet QR is the fallback.
- **One trip at a time:** a large +1 tally per trip, a did-not-operate switch,
  unscheduled trips, a review screen, and **Submit at pull-in**. Submitting
  replaces the paper sheet for that block, and the submit time is the
  timeliness proof.
- **Counting locks while the bus is moving** (AVL speed), because OPR-038 bans
  device use while operating.
- **Offline:** counts are kept on the device through dead zones and sent later.

Decisions this needs:

1. **Device.** OPR-038 bans personal electronic devices on duty, so this must
   be an MVTA-issued phone or tablet, or the MDT. Which?
2. **Mounting:** handheld, or mounted at the farebox.
3. **Buses with working APC:** skip manual counting, or count both during
   validation (§12).
4. **Rollout:** a pilot garage or route first, with paper as backup.

## Open

- **ServiceType (Q15).** Each trip carries a code (L, MX, RC, SX, DX) that
  varies within a route (e.g. 460 has L and MX trips), so it is a trip property,
  most likely from Optibus trip properties. Where OnBoard gets it, and what each
  code means, is unsettled. Until then the totals export cannot fill the
  `ServiceType` column.
- **Connect (v2).** Not designed; depends on the Spare export being reachable.
- **APC (C8).** See §12. Unknown which vehicles have working APC; no APC data reaches
  OnBoard today.
- **Terms for `CONTEXT.md`.** Count Sheet, Ridership count, Day type, Month
  close, and ServiceType once settled, before code is written.
