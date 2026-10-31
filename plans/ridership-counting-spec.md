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
- **Decided 2026-10-30** (`plans/ridership-build-plan.md`):
  - The QR code is printed from Dec 1.
  - Each trip row takes a total or **DNO** (did not operate).
  - Three blank rows take unscheduled trips.

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
- **Each trip** is keyed as a number, **Not counted** or **Did not operate**
  (decided 2026-10-30). Not counted is a visible gap, never a 0. Did not
  operate excuses the trip, pending the Dispatch Log and missed-trip cases.
- **Relief:** one operator per sheet. The first run is pre-filled, and other
  runs on the block are shown as a hint for an override.
- Every entry and change records who and when (P6).

**Layout (decided 2026-10-30, from the prototype's three options).** OCC lands
on a **worklist** of sheets still to enter: completeness by garage at the top,
then one row per sheet, late first, then due today. Choosing a row opens the
**sheet form**, laid out like the paper Count Sheet: Avail's operator, ID and bus with
an override, the block's trips in order with the Dispatch Log status, one total
per trip, add unscheduled trip, and Reconstructed. The form is keyboard-first:
Enter moves down the trips, and Save goes straight to the next sheet on the
worklist.

Why: a weekday is about 144 blocks (the APC sample day), so keying speed
matters. But each sheet also carries checks that belong to the sheet, not the
trip (operator/bus override, reconstructed, unscheduled trips, marking it
entered), and a single grid for the whole day (the prototype's Datasheet)
handled those worst. The paper-shaped form is the closest to Access, so it
needs the least retraining. The worklist puts §5's completeness and deadline
in front of OCC instead of on a separate page.

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

**Where it lives in the console (decided 2026-10-30).** Several roles use
ridership, so it is not a tab of OCC Tools (that would make every recorder
need `decision-matrix.view`, and Planning would not look for it there).

- A **Ridership** entry in the sidebar under **Specialist Operations**, next
  to Detours and Schedule Review, shown to anyone with `ridership.view`.
- Inside it, tabs gated by action, so each role sees only its own:

  | Tab | Who |
  |---|---|
  | Enter sheets (worklist opening the sheet form, §4) | recorder, manager |
  | Print sheets | recorder, manager |
  | Flags | recorder answers; manager also raises |
  | Month close | recorder marks complete; manager closes and reopens |
  | Totals & export | anyone with `ridership.view`; operator names hidden unless the role may see them |
  | APC comparison (future, §12) | manager |
  | APC health (future, §14) | recorder, manager; Fleet read-only |

- **Planning's setup** (the block-to-garage list and the flag thresholds) is an
  **Administration** page beside Service Configuration, listed once in
  `adminNav.ts` and gated by a `ridership.configure` action that only
  `ridership-manager` holds. A manager with no other admin action sees
  Administration with just this page.
- **Candidate occurrences** (§8) are confirmed in the existing **Compliance**
  area, not in Ridership.
- Creating the two roles and **assigning them to named people** (contractor
  OCC staff, Planning) in Access & Identity is an explicit step of the Dec 1
  delivery, not something left implied.

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
- Auth: `Ocp-Apim-Subscription-Key` header. **MVTA's existing Avail360 key
  works** (HTTP 200 on 2026-10-30).
- Production URL used for the sample:
  `https://avail360-api.myavail.cloud/ApcRidershipBySvcLvlBlockRouteTripTimepoint/v1/MVTA`.

**What one day returns** (sample pulled 2026-10-30 for service date
2026-10-28, a weekday; 3.9 MB, 15,171 rows, kept outside the repo):

- Envelope `{ "errors": [], "result": { "ApcRidershipBySvcLvlBlockRouteTripTimepoint": [...] } }`,
  the same shape as the other Avail360 reports.
- **One row per stop per trip**, not per timepoint. Fields: `CalendarDate`,
  `ServiceLevelDesc` ("Weekday"), `Block` (int, e.g. `1` = Block `001`),
  `RouteID` (int) / `RouteName`, `Trip` (int), `TripName` (`542-S`),
  `Direction` (North/South/East/West/Deadhead), `StopName`
  (`"30513 - Yankee Doodle Rd at …"`, stop ID then a truncated name),
  `Timepoint` (0/1 flag; 4,299 of the rows are timepoints), `Boards`, `Alights`.
- **`Trip` is the scheduled start time as HHMM** (542 = 05:42; every value is a
  valid time, max 2302). The Access table's TripID `143620542` for Route 436,
  Block 001 at 05:42 S carries the same number, so the two systems already
  share this key.
- **No vehicle, no operator, no actual time, no counter-health field.**
- Each trip can have **one row with `StopName` null**: 242 of 1,029 trips, 480
  boards in total. These are boardings APC counted but could not place at a stop.
  They belong in the trip's total.
- **Pseudo-routes** are in the same feed: `999` Deadhead (418 legs, 371
  boards; noise or garage boardings), `1121` MN United (33 boards, a special
  event), `4444` MVTA Connect, `1010` Flex, `5555` Training, `6666`
  Maintenance. These have `Trip` 0, `TripName` "(X) Undefined" and no direction.
- **Revenue only (routes 420–499):** 606 trips, **6,263 boards**, 6,050 alights.
  43 trips (7%) are all zeros; 2 of 144 blocks are zero throughout, which most
  likely means no working counter on that bus.
- One route, trip and direction appears on two blocks (460 07:50 N, blocks 23
  and 41), which looks like a double-out or tripper. This is the "unscheduled
  trip" case in §4, and APC sees it.

**First comparison with manual counts** (one APC day against September 2026's
average manual weekday by route, from `FixedTotals`; indicative only):

- **Trip counts match exactly** on 13 of 19 routes (e.g. 420: 30 = 30). The
  others are express routes where APC has 1–5 more trips (460: 30 vs 27,
  465: 51 vs 46), which are likely trippers that the manual roster doesn't
  carry.
- **APC boardings are 16% higher overall** (6,263 vs 5,396 per weekday) and
  higher on **every** route: from 1.05× (475) to 1.76× (499), and 1.4–1.5×
  on the local routes 436, 440 and 497. A gap that is systematic in one
  direction points to manual undercounting or APC over-counting, not to
  random error. This needs a same-day comparison: one October day of Access
  trip-level counts against this sample.

How it fits OnBoard:

- A seventh endpoint on `lib/availClient.ts` (`apc_ridership`), polled nightly
  for the previous service date, with dates in YYYY-MM-DD (the OTP feeds use
  MM-DD-YYYY).
- **Matching to the Dispatch Log:** Block (int → `001`) + route + direction +
  scheduled start (`Trip` HHMM) on the service date. There's no GTFS
  `trip_id`, and none is needed. APC trips that match no Dispatch Log trip are
  candidates for unscheduled trips.
- **APC per trip** = the sum of all its rows' `Boards`, including the null-stop
  row. Stop and timepoint rows are kept for drill-down.
- **Bus** comes from the GTFS-RT vehicle on each trip, with pull-out
  (`FixedRouteDepartures`, by block) as the fallback, not from this feed.
  Pull-out alone cannot see a mid-day bus change (§14).
- **Excluded from fixed-route totals:** routes 999, 1010, 4444, 5555, 6666.
  Route 1121 (MN United) is a possible source for special-event counts (C7).
- **A trip whose rows are all zero** is treated as "no APC" rather than "0
  riders" until Avail says how a faulty counter shows up.
- **Service level** ("Weekday") corresponds to the Day type in §9.

**Questions still for Avail:**

- Which MVTA vehicles have APC, and is the APC module licensed for MVTA?
- How a faulty or absent counter appears: all zeros, missing rows, or
  something else. Can the report carry the vehicle and a health flag?
- What the null-`StopName` row is: boardings between stops, or unmatched GPS?
- Why deadheads record boardings.
- How soon after the service day the data is complete, and whether it is
  restated later (compare ADR 0039 for OTP).
- Whether MVTA's APC data is certified for NTD reporting.
- The troubleshooting questions in §14.

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

## 14. Future — APC troubleshooting

Agreed with the user 2026-10-30 (design conversation, before anything is
built). It builds on §12: §12 compares APC with manual counts, and this section
explains **why** they disagree for a trip, a bus or a route, in either
direction. On 2026-10-28 APC ran about 16% above manual on every route, so the
tool must explain an over-count as well as an under-count.

**Two layers.**

1. **APC health**, nightly, on every trip, with no manual count needed. Most
   counter, GPS, cellular and logon faults show in APC and AVL data alone.
2. **Manual vs APC comparison** (§12) on top of it, only on buses the health
   layer finds usable.

**Unit: the bus-day** (one vehicle on one service date), with its trips
underneath. A counter, a GPS receiver and a modem belong to a bus, and Fleet
fixes buses. Route views roll bus-days up.

**Which bus ran a trip.** The GTFS-RT `vehicle_id` per trip
(`GtfsTripOperationalEvidence`), with pull-out (`FixedRouteDepartures`) as the
fallback. This replaces §12's pull-out join. On 2026-10-28 the two sources used
the same bus numbers and agreed on all 138 single-bus blocks, and GTFS-RT had a
vehicle for all 606 revenue trips. Pull-out holds one row per block, so it
cannot see a swap: 6 blocks ran on two buses according to GTFS-RT. When the two
sources disagree, OnBoard records a bus-swap finding and does not pick a
winner.

### Causes and their evidence

Each named cause is a **finding** with its evidence attached. Every threshold
is a setting, not code, as in §6. Starting values come from the 2026-10-28
sample and are retuned after a month of nightly runs.

| Family | Cause | Fingerprint | Corroboration |
|---|---|---|---|
| Equipment | Counter dead | Every trip on the bus-day is zero (2026-10-28: blocks 6, 313, 366) | Trips ran (Dispatch Log actual start, positions) |
| Equipment | Counter failing | ≥ 75% of trips zero, with a trickle on the rest (blocks 18: 7 of 9 trips zero, 4 boards; 358: 7 of 8, 1 board) | Same |
| Equipment | Counter miscalibrated | Bus-day alights ÷ boards stays far from 1 over several days (fleet median 0.97; block 349 at 0.63, 59 at 1.27). The APC ÷ manual ratio on that bus is steady across operators | Multi-day only; one day is too noisy |
| Equipment | GPS loss | Share of the bus-day's boardings on the null-`StopName` row > 25% (system 4.2%; block 63 at 87%, 49 at 59%) | Position gap ≥ 10 min inside a trip (new coverage columns) |
| Equipment | Cellular loss | A run of trips with no APC rows **and** no positions, then recovery | Coverage columns; the Dispatch Log shows the trips ran |
| AVL assignment | Counted outside a revenue trip | Deadhead (route 999) boardings > 15% of the bus-day (block 1: 17 deadhead vs 47 revenue) | Logon time against the first trip |
| AVL assignment | Late or missing logon | Pull-out `login_actual` after the first trip's scheduled start, or none | Low or zero APC on the early trips |
| AVL assignment | Wrong trip or block | APC trips that match no Dispatch Log trip, or one trip counted on two blocks | Dispatch Log, GTFS-RT trip assignment |
| AVL assignment | Swap without re-logon | GTFS-RT vehicle ≠ pull-out vehicle inside a block | — |
| Manual sheet | Sheet error | Bus healthy and the gap appears on one sheet only, or the gap follows one block or operator across buses | §6 flag history |
| Avail delivery | Late, restated or missing | A day's data arrives late or changes on re-pull; a trip that ran has no APC rows while the bus's other trips do | Nightly re-pull (below) |

**Deadhead boardings** are shown as a separate line, "counted outside a revenue
trip", on the bus-day and the route. They never go into a trip's total and are
never re-attributed, because the feed carries no times to place them by.

### Outcome

- Each bus-day carries **every finding that fired**, each with its evidence,
  plus a **leading cause** or **Undetermined**. A bus can fail two ways at
  once, and Undetermined is an allowed answer, as Indeterminate trip is for
  missed trips.
- Findings are proposals. A person **confirms or dismisses** them. Evidence
  corroborates and never decides (the ADR 0035 stance).
- Findings that repeat (same bus, same cause) roll up into **one open issue
  per bus and cause**: first seen, last seen, days affected; Confirmed or
  Dismissed; **Resolved** once a clean day follows a fix, which the next
  nightly run can show.

### Who it reaches

| Family | Goes to |
|---|---|
| Equipment | Fleet/maintenance, as a per-bus list |
| AVL assignment | Contractor dispatch (logon practice) and Avail support (trip matching on their side) |
| Manual sheet | The contractor, through the §6 flag flow |
| Avail delivery | Avail support |

Delivery: a console worklist, plus a **weekly digest email** for each audience.
A **newly dead counter** alerts the next morning. OnBoard has no work-order
system to write to.

**§6 flags.** When a flagged count sits on a bus-day with an open equipment or
assignment finding, the flag shows that finding as context ("APC not usable
here: counter dead"). It never resolves the flag, and no one settles a flag
against an unusable APC figure.

**§8 occurrences.** None in v1; the tool is diagnostic. Whether repeated
logon findings (contractor practice) should propose occurrences is for later.

### Console and access

- An **APC health** tab in Ridership (§10):
  - **Bus issues:** the open issues per bus and cause, with confirm and
    dismiss.
  - **Bus-day drill-down:** trips, boardings, unplaced boardings, deadhead
    boardings, position gaps, logon time, and the bus on each trip.
- The ridership roles from §10 use it. **Fleet gets a read-only view** of Bus
  issues.
- Avail APC delivery appears on **Integrations & Data Health** as a new feed.

### Data

- **Position coverage per trip.** OnBoard keeps no GPS history for ordinary
  service: `AvailAvlVehiclePositions` holds only each vehicle's current
  position, and history exists only during Events. Add a few columns to
  `GtfsTripOperationalEvidence` from the GTFS-RT poller: positions received,
  longest gap, and the gap's start and end. These **cannot be backfilled**, so
  they land early as a small change of their own. Missed-trip evidence can
  use them too.
- **APC backfill:** on the first run, pull the last 90 days so each bus has a
  baseline (miscalibration needs many days). Backfilled days get findings
  from APC alone, with no gap evidence, and say so.
- **Restatement:** re-pull the trailing 7 days each night and record changes
  as ADR 0039 does for OTP. A late or changed delivery is itself an Avail
  delivery finding.

### Build order

1. Position coverage columns on the GTFS-RT poller. Can go ahead of the rest.
2. APC ingestion (§12) with the health layer: the bus per trip, findings and
   bus-day issues.
3. Worklist, weekly digests, the next-morning dead-counter alert and the Fleet
   view.
4. The manual comparison, and finding context on §6 flags, once manual entry
   exists.

### Steps outside the code (numbered, owner in brackets)

1. Add a read-only APC health action (e.g. `ridership.apc-health.view`) and
   assign it to Fleet/maintenance staff in Access & Identity. [Engineering +
   an access administrator]
2. Name the digest recipients for Fleet, contractor dispatch and Avail
   support. [Planning + Operations]
3. Share Avail's APC health report for review, and fold its fields into the
   findings above. [User]

### Questions for Avail (added to §12's list)

- What the **APC health report** covers, its endpoint, and whether it carries
  the vehicle.
- How APC assigns a boarding to a trip when the operator is logged on to the
  wrong trip or not logged on, and whether those boardings go to Deadhead 999.
- Whether a counter that needs calibration can be seen on Avail's side
  (door-level counts, board/alight balance).
- Whether the ridership report can carry the vehicle and the door per row.
- Whether a null `StopName` means no GPS fix or only "between stops".

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
