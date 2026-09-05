# Dispatch Log — feature spec

Status: draft for review. Written 2026-08-18; §4.3 revised 2026-08-20 after Ty
settled the UI as three views over one dataset; revised 2026-09-04 after a
repo review checked every claim against the code (see §9 for what changed).
Source material: Ty ↔ Corrina Gumphrey email thread 2026-08-18, plus two
workbooks in an `OTP/` folder that lives **outside this repo** (SharePoint
material; ask Ty for a copy — the counts in §2 cannot be re-derived from the
repo alone):

- `9. Dispatch Log_20260908.xlsx` — the **raw scheduling-system export** ("the
  Dispatch Log from the Service Info SharePoint"), 3 sheets: Weekday / Friday /
  Weekend. The date in the filename is presumably the service change the export
  describes (8 Sept 2026), not the export date — it post-dates this document.
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
| Which trips run on a given date | `GtfsCalendar` + `GtfsCalendarDates`, plus `activeServiceIdsToday()` in `gtfsMissedTripsPoll.ts` (module-private today — see §4.2) |
| Service-date / GTFS-time → UTC | `missedTripTime.ts` (`serviceDateAndGtfsSecondsToUtc`, `agencyServiceDate`) — DST-correct |
| Nightly static refresh | `gtfsStopsSync.ts`, 09:00 UTC daily |
| **Actual trip start** | `GtfsTripOperationalEvidence.first_underway_at` (mig. 027) — set when a VehiclePosition reports `current_stop_sequence > first_stop_sequence`, i.e. when the bus is already reported at or past stop **two** |
| Cancellations / no-shows | `MonitoredMissedTrips` + `gtfsMissedTripsPoll.ts` |
| Garage pullout actuals | `FixedRouteDepartures` (Avail, mig. 013) — authoritative for pullout, not for first revenue stop |

So the Dispatch Log is largely a **read model over tables that already exist**,
plus a small amount of new storage for the human layer.

### The real gaps

1. **`Alternative` has no GTFS equivalent.** It is a scheduling-system
   (Optibus) concept encoded in that system's `Route Id`. GTFS `route_id` will
   not carry it. Either drop the column, or import it from the SharePoint
   export as reference data.
2. **Actual-start precision and bias.** `first_underway_at` is a *detection*
   time from a **5-minute** poll (`gtfsVehiclePositionsPoll.ts`). The entire
   business rule turns on a 5-minute threshold, so a 5-minute poll cannot
   reliably tell "on time" from "5 minutes late." It is also **biased late**,
   not just imprecise: the flag is set only once the reported stop sequence
   exceeds the first stop, so it records the bus reaching stop two, not
   leaving stop one. On a long first link that bias alone flips an on-time
   departure to "late". See §5.
3. **History is destructible.** `gtfsStopsSync` does a full `TRUNCATE` +
   reload. Once a service change lands, a past date's log cannot be
   reconstructed from `GtfsScheduledTrips`. The log must snapshot per service
   date (same reasoning as ADR 0012, and the same pattern
   `FixedRouteDepartures` already uses).

---

## 4. Proposed design

**Naming.** The product name stays *Dispatch Log* — it is what the OCS desk
calls the workbook. Technical identifiers do **not** use the word `dispatch`,
because in this repo it already means Teams message delivery
(`functions-dispatch`, `dispatchMessageCreated`, `dispatchConfirmation`). A
`DispatchLogTrips` table or a `/dispatch-log` route would read as a message
delivery log. Tables and routes below are therefore `TripStart*` /
`/trip-start-log`. `docs/agents/domain.md` carries the same distinction.

### 4.1 Data model (new migration)

Number it **094 or later**. `main` ends at 088, but 089–093 exist on the
unmerged detour branch and were applied to the dev database on 2026-09-04, so
anything lower collides.

**`TripStartLog`** — one row per (service date, revenue trip), materialized
nightly. A growing historical log; never truncated.

```
service_date            CHAR(8)        -- YYYYMMDD; matches FixedRouteDepartures. GtfsTripOperationalEvidence
                                       -- stores the same value as NVARCHAR(20): CAST explicitly when joining.
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
in_rotation             BIT                    -- on today's verification list (snapshot, see below)
rotation_day            NVARCHAR(10)   NULL    -- the weekday this trip is dealt to this week
actual_start_at         DATETIME2      NULL
actual_start_source     NVARCHAR(20)   NULL    -- trip_update | vehicle_position | avail
start_delay_seconds     INT            NULL
start_status            NVARCHAR(20)   NULL    -- on_time | late | missed | canceled | unknown
materialized_at         DATETIME2
updated_at              DATETIME2
PRIMARY KEY (service_date, trip_id)
```

Built as `migration-094-trip-start-log.sql` (2026-09-04, §8 step 1).

`start_status` sources: `on_time` / `late` from `actual_start_at` against the
5-minute rule; `canceled` from the TripUpdate `schedule_relationship`
(`mapCanceledTrip` in `gtfsTripUpdates.ts`, the same path the missed-trip
poller uses); `missed` from a `MonitoredMissedTrips` row for the trip;
`unknown` when the trip has no realtime evidence at all. Never default to
`on_time`.

**`TripStartVerifications`** — the human layer, kept separate so an operator's
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

**Rotation.** The workbook deals a *fixed* pool by index for the whole
service change. Rebuilding the pool from each date's active `service_id`s
would break that — Friday's trip set differs from Mon–Thu, so every index
shifts and the "each trip once per week" guarantee is lost. The pool must be
defined once per service change:

- **Pool membership.** Decided per *rotation week* (the 7 days from
  `anchor + 7 × weekOffset`), not per date. Weekday pool = every trip in
  `GtfsScheduledTrips` whose service runs on at least one Mon–Fri date in
  that window (from `GtfsCalendar`, plus type-1 `GtfsCalendarDates`
  additions, minus type-2 removals). Weekend pool = the same for the Sat/Sun
  dates. Scoping to the week is what keeps a *future* service change's trips
  out of the current pool when the static feed carries both. A trip can be in
  both pools; that matches the workbook, which lists it on both sheets.
- **Order.** Sort by `(first_departure_seconds, trip_id)`. The `trip_id`
  tie-break is what makes the assignment reproducible; start time alone is
  not unique.
- **Anchor.** `rotation_anchor_date` is the service-change start date, stored
  in `AppSettings` (`module = 'trip_start_log'`). It is a setting, not a
  derivation, so a mid-change GTFS republish cannot silently restart the
  rotation — which also means a new service change is a deliberate edit of
  the setting, not something the sync detects. The only automatic write is a
  one-time seed when the value is blank: the earliest `GtfsCalendar.start_date`,
  or, because MVTA's feed publishes service through `calendar_dates.txt`
  alone, the earliest type-1 `GtfsCalendarDates.service_date`. The seed is
  logged as a warning to confirm.
- **Assignment.** `weekOffset = floor(days(service_date − anchor) / 7)`;
  weekday trip *i* is assigned `[Mon..Fri][(i + weekOffset) % 5]`, weekend
  trip *i* `[Sat, Sun][(i + weekOffset) % 2]`. `in_rotation` is true when the
  assigned day equals the service date's day **and the trip is actually
  active that date**. That second clause is what removes the Friday problem
  in §2: a Mon–Thu-only trip dealt to Friday is simply not asked for that
  week, instead of appearing on the log as a trip that never runs.

`in_rotation` is written at materialization and treated as a snapshot. If the
anchor or pool later changes, past days keep the assignment they were logged
under; only future days are re-dealt.

### 4.2 Backend

| Piece | Shape |
|---|---|
| `tripStartLogMaterialize.ts` | Timer, **09:30 UTC** (`0 30 9 * * *`; 04:30 CDT / 03:30 CST). Must be scheduled in UTC: `gtfsStopsSync` runs at 09:00 UTC, and a "03:00 local" schedule lands *before* it for the eight months of daylight time, building the log from yesterday's schedule. Resolves active `service_id`s for the date, joins the schedule tables, computes `in_rotation` (§4.1), writes `TripStartLog`. Runs for today **and** tomorrow so the log exists before the first pullout. Near a service change tomorrow can have no active services: check `scheduleCoverage()` (`gtfsScheduleHorizon.ts`) first, and warn + skip rather than write an empty day that reads as "no service". |
| `tripStartActualsPoll.ts` | Timer, 1-minute. Reads GTFS-RT TripUpdate and captures each trip's **first-stop** `StopTimeUpdate` departure as described in §5 — treated as a prediction until the first stop drops off the trip's update list, at which point the last value seen is frozen as the actual. Fills `actual_start_at` / `start_delay_seconds` / `start_status`. Falls back to `first_underway_at` when the first stop was never seen. Note this is a third consumer of a feed two pollers already share at a 5-minute cadence (`readTripUpdateFeed` writes the `gtfs_trip_updates` health row once per delivery); the 1-minute reader must not overwrite that health record with its own cadence. |
| `GET /trip-start-log?date=` | Returns the service date's rows joined to verifications. One row per revenue trip, including `in_rotation` — the rotation is a field, not a query parameter. |
| `POST /trip-start-log/verify` | Records one observation. Server-enforced role check. |
| `GET /trip-start-log/export` | CSV, for parity with the workbook people will miss. |

Reuse throughout: `serviceDateAndGtfsSecondsToUtc()` and `agencyServiceDate()`
are exported from `missedTripTime.ts` and tested. `activeServiceIdsToday()` is
**not** exported — it is a module-private function in `gtfsMissedTripsPoll.ts`
— so step 1 of §8 starts by lifting it into a lib. `gtfsScheduleHorizon.ts`
already mirrors its coverage rule and is the natural home.

**One endpoint, not three.** The three views in §4.3 are presentation over a
single `GET /trip-start-log?date=` returning one row per revenue trip for the
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
  Origin Stop · Direction` (+ `Alternative` only if §7.3 is resolved).
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

1. **Capture the first stop's departure from GTFS-RT TripUpdate** (recommended,
   with a caveat). `StopTimeUpdate.Departure.Time`/`.Delay` for the trip's
   first `stop_sequence` carries second-level precision, but it is a
   **prediction until the departure happens, and producers usually drop a
   stop from the list once it is passed** — the repo's own mapper relies on
   exactly that, treating the lowest remaining `StopSequence` as the *next*
   stop (`mapTripUpdateEntity` in `gtfsTripUpdates.ts`). So the value is not
   independent of poll cadence: a 5-minute reader will mostly see a forecast
   for stop one and then see stop one vanish. The capture rule is therefore
   *poll every minute; keep the latest first-stop value; freeze it as the
   actual the first time the first stop is absent from that trip's list*. The
   frozen value is the producer's last prediction before departure, typically
   within a minute of the event — good enough for a 5-minute rule, and far
   better than `first_underway_at`. `gtfsTripUpdates.ts` already parses the
   full `StopTimeUpdate` list; this is a targeted extension, not new plumbing.
   **Prerequisite:** confirm empirically, on MVTA's feed, whether the first
   stop drops off after departure or lingers with a realised time. If it
   lingers, the capture is simpler and more precise than described here; if
   it drops, the rule above stands.
2. **Poll VehiclePositions every minute** instead of every 5. Straightforward,
   costs more invocations, still poll-bounded, and still carries the stop-two
   bias from §3 gap 2.
3. **Use the Avail AVL feed** (`availAvlPoll.ts`, every 15 seconds — by far the
   most precise source available). Highest fidelity; needs the AVL record
   matched to a GTFS trip, which is real work.

Recommendation: **(1) as the primary source, `first_underway_at` as fallback**,
and record which source produced each actual in `actual_start_source` so the
provenance is never ambiguous. Revisit (3) if second-level accuracy turns out to
matter for contractor performance rather than just situational awareness.

---

## 6. Honest limitations to carry into the build

- **`Alternative` cannot come from GTFS.** Unresolved until §7.3 is decided.
- **Friday service differs** from Mon–Thu. The workbook's single weekday pool
  occasionally asks for a trip that does not run that day; the materialized
  log never does (§4.1, `in_rotation` requires the trip to be active), but the
  trip dealt to Friday is then simply skipped that week. Splitting Friday into
  its own pool would verify it instead, and matches the source export.
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
   contractor-facing operational role today — every role in `auth.ts` is
   `OCC.*` or `System.Ingestion`, and assessment contractors are isolated for a
   different purpose). If they do get access, the precedent is `OCC.Detour`:
   a dedicated, **additive** app role for one workflow, registered on the app
   registration and assigned per user, with the existing roles keeping the
   access they already had. An `OCC.TripStartVerify` role on the same pattern
   grants the `POST …/verify` endpoint and nothing else; the runbook is
   `docs/runbooks/access-management-entra.md`. Alternatives: MVTA OCC records
   it, or the verification column is dropped entirely because the actual
   start times make it redundant.
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
4. ~~**Where does it live?**~~ **Resolved by ADR 0015**, which groups
   communications and service-risk monitoring under Service Operations and
   keeps Compliance for assessment artifacts. The Dispatch Log is a live
   monitoring tool, so it is a Service Operations tab, next to Service Risk &
   Quality (Missed Trips and Fixed Route Departures live on the Compliance
   tab, which is the investigation side). Readers are the API's read roles:
   staff plus `OCC.Compliance`. Nothing here is a compliance record until
   §7.1 puts a verified observation on it, and even then it stays where the
   people who use it during the day already are.

---

## 8. Suggested build order

Nothing before step 5 depends on the open decisions in §7.

1. **Lift `activeServiceIdsToday()` into a lib, then migration (094+) +
   nightly materialization + `GET /trip-start-log`** — read-only, from data
   already flowing. Provable end to end without any new feed work.
   *Built 2026-09-04:* `gtfsScheduleHorizon.ts` (helper), `migration-094`,
   `tripStartLogMaterialize.ts`, `tripStartLog.ts`, rotation in
   `tripStartRotation.ts`. The materializer also excludes routes actively
   classified `SpecialEvent` on the date, the same rule as the silent-no-show
   detector, so an overridden base-schedule trip is not listed as a phantom.
2. **Module shell**: query bar, summary strip, view switcher, shared selection
   state and inspector. The container before any of the views, so all three
   inherit filtering and selection rather than each re-implementing it.
   *Built 2026-09-05:* `routes/modules/tripStartLog/` in the console, at
   `/service-operations/dispatch-log`. State and every derived read (filters,
   sort, summary buckets, start OTP, awaiting-initials) are pure functions in
   `tripStartLogState.ts`. Summary buckets are On time · Left late ≤5 · Late
   over 5 · Missed · No actual · Canceled — `missed` and `no actual` kept
   apart because one is a verdict and the other is absence of evidence, and
   neither canceled nor no-actual counts toward start OTP. Until step 3 every
   view shows the same interim row list so selection and the inspector work
   end to end; the verify actions are present but disabled until step 6.
3. **Grid view**, actuals shown, no verification column yet. Built as a reusable
   sortable table (§4.3).
4. **Watch and Timeline views** over the same state. Independent of each other;
   either can ship first.
5. **First-stop actual-departure capture from TripUpdate** (§5, option 1),
   after the feed-behaviour check that option requires. Everything above works
   on `first_underway_at`; this is the precision upgrade, and the ±5-minute
   error bar plus the stop-two bias make the ≤5-minute rule unreliable until
   it lands.
6. **Verification recording**, once §7.1 is decided. The UI already has the
   affordance in three places — this is the endpoint, the role check, and the
   audit trail.
7. **CSV export**, for parity with the workbook people will miss.

---

## 9. Revision log

**2026-09-04** — repo review against `main` at `f5e11e8`. Every table, column,
migration and poll cadence cited in §3 was confirmed. Corrections made:

- Materialization timer moved to 09:30 UTC; "03:00 local" preceded
  `gtfsStopsSync` during daylight time (§4.2).
- §5 option 1 rewritten: first-stop `StopTimeUpdate`s are predictions that
  drop off once passed, so capture needs the 1-minute poll and a freeze rule,
  plus an empirical check of the feed (§5, §4.2).
- `first_underway_at` documented as biased late (fires at stop two), not only
  imprecise (§3 gap 2, §5).
- Rotation fully specified: fixed pool per service change, `(start, trip_id)`
  order, anchor date in `AppSettings`, `in_rotation` requires the trip to be
  active that date (§4.1). This also closes the Friday inconsistency (§2, §6).
- Technical identifiers renamed `TripStart*` / `/trip-start-log`; `dispatch`
  already means Teams message delivery in this repo (§4). Product name
  unchanged.
- Migration numbering set to 094+ (§4.1). `service_date` type reconciled with
  the evidence table (§4.1). `start_status` sources stated (§4.1). Tomorrow's
  materialization guarded by `scheduleCoverage()` (§4.2).
- `activeServiceIdsToday()` noted as module-private; lifting it is now step 1
  of §8.
- §7.4 resolved by ADR 0015 (Service Operations). §7.1 given the `OCC.Detour`
  additive-role precedent.
- Cross-references `§3.1` / `§5.1` fixed; source workbooks flagged as outside
  the repo; export filename date explained.
- Feature added to the roadmap (`MVTA_ONBOARD_MANUAL.md` §20,
  `plans/ROADMAP.md`) and the `dispatch` distinction to `docs/agents/domain.md`.
