# Dispatch Log — feature spec

Status: draft for review. Written 2026-08-18; §4.3 revised 2026-08-20 after Ty
settled the UI as three views over one dataset. Source material: Ty ↔ Corrina
Gumphrey email thread 2026-08-18, plus two workbooks in `OTP/`:

- `9. Dispatch Log_20260908.xlsx` — the **raw scheduling-system export** ("the
  Dispatch Log from the Service Info SharePoint"), 3 sheets: Weekday / Friday /
  Weekend.
- `Copy of Dispatch Log Template 810 Service Change.xlsx` — the **working
  template** Corrina hand-derives from it, 4 sheets: Weekday / Weekend, plus
  one per-week sheet (`8-10 - 8-16`, `8-17 - 8-23`).

---

## 1. What the process actually is today

MVTA's contracted operator (SST) staffs the OCS desk. Each OCS keeps a shared
Excel workbook open during their shift and **initials each revenue trip as they
watch it start**. This is a live monitoring ritual, not after-the-fact
record-keeping — the point is to notice a trip that is about to be missed while
there is still time to do something about it, and to carry a running feel for
OTP through the day.

Rules, verbatim from Corrina:

| Question | Answer |
|---|---|
| Generated how? | Take the scheduling-system Dispatch Log export from the Service Info SharePoint, delete the unneeded columns, add formatting. |
| Who fills it in? | All SST OCSs, in real time, in a shared workbook. SST *leadership* has no access and does not interact with it. |
| Trip starts late? | Within 5 minutes → mark that it left late. More than 5 minutes → **leave blank** and follow normal late-route procedures. |
| Deadheads? | Not tracked. Revenue trips only — and only the revenue trip itself, not the deadhead that positions the bus for it. |
| MVTA's role? | Monitor through the day that it is being completed. Nothing is done with completed logs. |
| Trip selection? | Every trip is verified **once per week**. Trips sort by start time and are dealt out across the days of the week (weekday trips Mon–Fri, weekend trips Sat or Sun). Each following week the assignment shifts down one day, and that continues for the whole service change. |

The rotation is explicitly a convenience choice ("easy to create and copy for
me, and easy to organize and log for the specialists"), not a statistical
sampling design. Worth remembering when deciding whether to keep it.

### The gap this process exists to fill

Nobody has an automated answer to "did this trip start on time?" The initialing
ritual is a manual substitute for a signal OnBoard already collects.

---

## 2. The artifact, decoded

### Template columns (the working log)

| Col | Header | Comes from (raw export) |
|---|---|---|
| A | **Verified** | *staff input* — OCS initials, blank until observed |
| B | **Day of Week** | *assignment* — rotation, not in any feed |
| C | **Start Time** | `Start Time` of the `service_trip` event |
| D | **Block** | `Vehicle Block Id` |
| E | **Route** | `Sign` (note: display sign, e.g. `495`, `Orange LINK` — not `Route Id`) |
| F | **Origin Stop Name** | `Origin Stop Name` |
| G | **Direction** | `Direction`, with `EASTBOUND`→`3`, `WESTBOUND`→`4` (counts confirm: 21 EB → 21 `3`, 19 WB → 19 `4`) |
| H | **Alternative** | trailing segment of `Route Id` (`444-2-A` → `A`; `-` = none) |

Everything else in the export (Trip Id, Layover, Distance, vehicle types,
Service Groups, Overlap, Next…) is dropped.

### Filtering

The raw export interleaves four `Event Type` values. Only `service_trip`
survives:

| Sheet | Rows | pull_out | **service_trip** | deadhead | pull_in |
|---|---|---|---|---|---|
| Weekday | 1026 | 144 | **606** | 132 | 144 |
| Friday | 917 | 128 | **559** | 102 | 128 |
| Weekend | 348 | 36 | **241** | 35 | 36 |

Template Weekend = **241 rows exactly**, matching the export's weekend
`service_trip` count. Template Weekday = 581 (from a different service change,
so it does not line up numerically with the Sept export above).

### Rotation algorithm

Two independent pools, each dealt round-robin in start-time order:

- **Weekday pool** → `[Mon, Tue, Wed, Thu, Fri][(index + weekOffset) % 5]`
  → 581 trips split 117/116/116/116/116.
- **Weekend pool** → `[Sat, Sun][(index + weekOffset) % 2]`
  → 241 trips split 121/120.

`weekOffset` increments by 1 each week — confirmed against the two weekly
sheets: block 1's 03:20 trip is Monday in `8-10 - 8-16` and Tuesday in
`8-17 - 8-23`. The weekly sheets merge both pools and re-sort by start time
(822 = 581 + 241 rows), so a single sheet drives the whole week.

Consequence: over 5 weeks every weekday trip is observed on each weekday; over
2 weeks every weekend trip is observed on each weekend day.

### One inconsistency worth naming

The raw export has a **separate Friday sheet** — Friday service genuinely
differs (e.g. route 460 runs 30 weekday trips but 17 on Friday). The template
folds Friday into the single Weekday pool, so the trips assigned to a Friday
slot are Mon–Thu trips that may not exist that day. Small, but it means the log
can ask an OCS to verify a trip that isn't scheduled to run.

---

## 3. What OnBoard already has

Nearly the whole schedule side is built and running.

| Need | Already there |
|---|---|
| Scheduled start time | `GtfsScheduledTrips.first_departure_seconds` (mig. 011) — first stop's `departure_time`, seconds-since-midnight, handles `>24:00:00` |
| Origin stop | `GtfsScheduledTrips.first_stop_id` (mig. 027) → `GtfsStops.stop_name` |
| Block | `GtfsScheduledTrips.block_id` (mig. 027), parsed from `trips.txt` |
| Route display name | `GtfsRoutes.route_short_name` (mig. 010) |
| Direction | `GtfsTripDirections.direction_id` / `direction_label` (mig. 007) |
| Which trips run on a given date | `GtfsCalendar` + `GtfsCalendarDates`, plus `activeServiceIdsToday()` in `gtfsMissedTripsPoll.ts` |
| Service-date / GTFS-time → UTC | `missedTripTime.ts` (`serviceDateAndGtfsSecondsToUtc`, `agencyServiceDate`) — DST-correct |
| Nightly static refresh | `gtfsStopsSync.ts`, 09:00 UTC daily |
| **Actual trip start** | `GtfsTripOperationalEvidence.first_underway_at` (mig. 027) — set when a VehiclePosition reports `current_stop_sequence > first_stop_sequence` |
| Cancellations / no-shows | `MonitoredMissedTrips` + `gtfsMissedTripsPoll.ts` |
| Garage pullout actuals | `FixedRouteDepartures` (Avail, mig. 013) — authoritative for pullout, not for first revenue stop |

So the Dispatch Log is largely a **read model over tables that already exist**,
plus a small amount of new storage for the human layer.

### The real gaps

1. **`Alternative` has no GTFS equivalent.** It is a scheduling-system
   (Optibus) concept encoded in that system's `Route Id`. GTFS `route_id` will
   not carry it. Either drop the column, or import it from the SharePoint
   export as reference data.
2. **Actual-start precision.** `first_underway_at` is a *detection* time from a
   **5-minute** poll (`gtfsVehiclePositionsPoll.ts`). The entire business rule
   turns on a 5-minute threshold, so a 5-minute poll cannot reliably tell
   "on time" from "5 minutes late." See §5.
3. **History is destructible.** `gtfsStopsSync` does a full `TRUNCATE` +
   reload. Once a service change lands, a past date's log cannot be
   reconstructed from `GtfsScheduledTrips`. The log must snapshot per service
   date (same reasoning as ADR 0012, and the same pattern
   `FixedRouteDepartures` already uses).

---

## 4. Proposed design

### 4.1 Data model (new migration)

**`DispatchLogTrips`** — one row per (service date, revenue trip), materialized
nightly. A growing historical log; never truncated.

```
service_date            CHAR(8)        -- YYYYMMDD
trip_id                 NVARCHAR(100)
block_id                NVARCHAR(100)  NULL
route_id                NVARCHAR(50)
route_short_name        NVARCHAR(50)   NULL   -- snapshot, survives service change
direction_id            INT            NULL
direction_label         NVARCHAR(10)   NULL
origin_stop_id          NVARCHAR(100)  NULL
origin_stop_name        NVARCHAR(200)  NULL   -- snapshot
scheduled_start_seconds INT                    -- GTFS seconds, >86400 allowed
scheduled_start_at      DATETIME2              -- resolved UTC instant
in_rotation             BIT                    -- on today's verification list
actual_start_at         DATETIME2      NULL
actual_start_source     NVARCHAR(20)   NULL    -- trip_update | vehicle_position | avail
start_delay_seconds     INT            NULL
start_status            NVARCHAR(20)   NULL    -- on_time | late | missed | canceled | unknown
PRIMARY KEY (service_date, trip_id)
```

**`DispatchLogVerifications`** — the human layer, kept separate so an operator's
observation is never overwritten by a poller.

```
service_date       CHAR(8)
trip_id            NVARCHAR(100)
observation        NVARCHAR(20)   -- observed_on_time | observed_left_late | not_observed
verified_by        NVARCHAR(200)  -- Entra identity
verified_initials  NVARCHAR(10)
verified_at        DATETIME2
note               NVARCHAR(500)  NULL
PRIMARY KEY (service_date, trip_id)
```

Rotation is **computed, not stored**: `weekOffset` derives from weeks elapsed
since the service-change start date, so no per-week table is needed and the
assignment is reproducible for any date.

### 4.2 Backend

| Piece | Shape |
|---|---|
| `dispatchLogMaterialize.ts` | Timer, ~03:00 local (after `gtfsStopsSync`). Resolves active `service_id`s for the date, joins the schedule tables, computes `in_rotation`, writes `DispatchLogTrips`. Runs for today **and** tomorrow so the log exists before the first pullout. |
| `dispatchLogActualsPoll.ts` | Timer, 1-minute. Reads GTFS-RT TripUpdate, extracts each trip's **first-stop** `StopTimeUpdate` departure, fills `actual_start_at` / `start_delay_seconds` / `start_status`. Falls back to `first_underway_at` when TripUpdate has no first-stop entry. |
| `GET /dispatch-log?date=` | Returns the service date's rows joined to verifications. One row per revenue trip, including `in_rotation` — the rotation is a field, not a query parameter. |
| `POST /dispatch-log/verify` | Records one observation. Server-enforced role check. |
| `GET /dispatch-log/export` | CSV, for parity with the workbook people will miss. |

Reuse throughout: `activeServiceIdsToday()`, `serviceDateAndGtfsSecondsToUtc()`,
`agencyServiceDate()` — all already written and tested.

**One endpoint, not three.** The three views in §4.3 are presentation over a
single `GET /dispatch-log?date=` returning one row per revenue trip for the
service date. Filtering, sorting, grouping by block and selection all stay
client-side — a day is under a thousand rows, so there is no case for
per-view queries, and any server-side split would let the views disagree.

### 4.3 UI — one module, three views

Decided 2026-08-20 (Ty): the three explored layouts are **view modes of the
same dataset**, not alternatives to choose between. Working prototype:
<https://claude.ai/code/artifact/c2740c6d-2c47-4b0d-b391-7ea4389983b9>

The module owns one query and one piece of state. Views are presentation only.

```
state = { view, search, route, status, rotationOnly, selectedTripId, sortKey, sortDir }
```

#### Shared across every view

| Element | Behaviour |
|---|---|
| **Query bar** | Search (route/block/stop/direction/alt), route select, status select, All trips ⇄ Today's rotation. Applies to whichever view is open; `Clear` appears only when a filter is active. |
| **Summary strip** | On time · Left late ≤5 · Late over 5 · No actual · Start OTP, each computed over the **filtered** set, plus a count of rotation trips still awaiting initials. |
| **Selection** | One `selectedTripId`. Selecting in any view carries into the others — pick a chip in Timeline, switch to Grid, that row is highlighted. |
| **Inspector** | Persistent panel below the view. Scheduled, actual, delta, origin, alternative, rotation day, verification, plus the verify actions. Replaces the per-view detail panels. |
| **Verification** | Writing an observation from any view updates the same record, so views can never disagree. |

#### Grid

The spreadsheet reading, and the default.

- Sticky header, `Verified` pinned as a sticky first column, click-to-sort on
  every column, keyboard row navigation.
- Default sort: scheduled start ascending — matches the workbook.
- Columns: `Verified · Scheduled · Actual · Δ · Status · Block · Route ·
  Origin Stop · Direction` (+ `Alternative` only if §3.1 is resolved).
- `Verified` is a one-click cell cycling unverified → on time → left late,
  showing the signed-in user's initials exactly like the workbook.
- Rows outside today's rotation are dimmed but present — the whole day is
  visible; the rotation only marks what needs initialing.

#### Watch

For the live monitoring the desk actually does.

- **Up next**: every trip due in the next 90 minutes. Rotation trips are
  highlighted and carry inline verify actions; the rest are listed for
  awareness, marked `tracked`.
- **Needs disposition**: late / missed / no-RT-data trips ordered by severity,
  each with an explicit disposition action rather than a blank cell.
- Prototyping this surfaced a constraint worth recording: **the rotation is too
  sparse to drive a watch queue on its own.** Tuesday carries 16 rotation trips
  across 18 hours, with a 2h48m gap between 13:57 and 16:45 — a rotation-only
  queue renders empty for long stretches. Hence "all upcoming trips, rotation
  ones flagged".

#### Timeline

For the thing neither table can show: how lateness moves along a block.

- One lane per block, time left to right, `now` marked.
- A hairline tick marks the **scheduled** minute; the chip sits at the
  **actual** start. Lateness therefore reads as displacement, with a slip bar
  spanning the gap — not as a colour you have to decode.
- Lanes are drawn from the filtered set, so filtering to one route collapses
  the timeline to just the blocks that serve it.
- Needs horizontal room: it scrolls inside its own container below ~900px
  rather than reflowing, and never scrolls the page body sideways.

#### Cross-cutting

- Auto-computed `Status` is shown **beside** the human observation, never
  instead of it. Where they disagree, that disagreement is the signal.
- The rotation is a **filter, not a separate dataset** — "today's rotation"
  narrows the same rows every view already holds.
- Live refresh on the existing `FixedRouteRefreshContext` cadence.
- Every view needs a real empty state; filtering to a single status legitimately
  reduces the day to one row.

There is no shared sortable-table component in the console today (every module
rolls its own). The Grid view should be built to be reused.

---

## 5. The precision problem — recommendation

The rule is a 5-minute threshold. The current actual-start signal
(`first_underway_at`) comes from a 5-minute poll, so its error bar is the same
size as the decision it has to inform. Options, cheapest first:

1. **Capture the first stop's departure from GTFS-RT TripUpdate** (recommended).
   `StopTimeUpdate.Departure.Time`/`.Delay` for the trip's first
   `stop_sequence` is a *reported* time with second-level precision, independent
   of how often we poll. `gtfsTripUpdates.ts` already parses the full
   `StopTimeUpdate` list; this is a targeted extension, not new plumbing.
2. **Poll VehiclePositions every minute** instead of every 5. Straightforward,
   costs more invocations, still poll-bounded.
3. **Use the Avail AVL feed** (`availAvlPoll.ts`, every 15 seconds — by far the
   most precise source available). Highest fidelity; needs the AVL record
   matched to a GTFS trip, which is real work.

Recommendation: **(1) as the primary source, `first_underway_at` as fallback**,
and record which source produced each actual in `actual_start_source` so the
provenance is never ambiguous. Revisit (3) if second-level accuracy turns out to
matter for contractor performance rather than just situational awareness.

---

## 6. Honest limitations to carry into the build

- **`Alternative` cannot come from GTFS.** Unresolved until §3.1 is decided.
- **Friday service differs** from Mon–Thu; a single weekday pool will
  occasionally schedule a verification for a trip that does not run that day.
  Splitting Friday into its own pool fixes it and matches the source export.
- **`Route` is the display sign, not `route_id`.** `route_short_name` is the
  right GTFS field; confirm it renders `Orange LINK` and not `425`.
- **GTFS-RT coverage is not universal.** Any trip absent from the realtime feed
  has an unknown actual, and must display as unknown rather than as on-time.
- **A verification is an observation, not a measurement.** It records what a
  person saw. It should never be silently overwritten by a poller.

---

## 7. Open decisions

1. **Who records verifications?** SST OCS staff do this today in shared Excel.
   Giving them console accounts is a real access-management change (there is no
   contractor-facing operational role today — assessment contractors are
   isolated for a different purpose). Alternatives: MVTA OCC records it, or the
   verification column is dropped entirely because the actual start times make
   it redundant.
2. **Keep the weekly rotation?** It exists because a person had to build the
   workbook by hand. Once every trip's actual start is captured automatically,
   sampling one-fifth of trips per day buys nothing on the measurement side —
   though it still structures *what a human is asked to watch*, which is the
   part that catches problems early. Evidence from the prototype: a single day's
   rotation is 16 trips across 18 hours with a 2h48m gap in the middle, so it is
   too sparse to be the *only* thing a monitoring view shows (§4.3, Watch).
   Keeping it as a "who owes initials" flag over the full day works; making it
   the dataset does not.
3. **`Alternative` column** — drop it, or import the SharePoint export as
   reference data to preserve it?
4. **Where does it live?** Compliance tab (next to OTP / Missed Trips /
   Fixed Route Departures), Service Operations (it is a live monitoring tool,
   not a compliance artifact), or its own top-level nav entry?

---

## 8. Suggested build order

Nothing before step 5 depends on the open decisions in §7.

1. **Migration + nightly materialization + `GET /dispatch-log`** — read-only,
   from data already flowing. Provable end to end without any new feed work.
2. **Module shell**: query bar, summary strip, view switcher, shared selection
   state and inspector. The container before any of the views, so all three
   inherit filtering and selection rather than each re-implementing it.
3. **Grid view**, actuals shown, no verification column yet. Built as a reusable
   sortable table (§4.3).
4. **Watch and Timeline views** over the same state. Independent of each other;
   either can ship first.
5. **First-stop actual-departure capture from TripUpdate** (§5.1). Everything
   above works on `first_underway_at`; this is the precision upgrade, and the
   ±5-minute error bar makes the ≤5-minute rule unreliable until it lands.
6. **Verification recording**, once §7.1 is decided. The UI already has the
   affordance in three places — this is the endpoint, the role check, and the
   audit trail.
7. **CSV export**, for parity with the workbook people will miss.
