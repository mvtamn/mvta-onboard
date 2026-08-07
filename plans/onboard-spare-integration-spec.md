# MVTA OnBoard — Spare API Integration Spec
## Garage Departure Times, Missed Trips, Mean Wait Time, Ridership Counters

**Context:** Spare's API has no single endpoint/field for any of these three metrics as originally scoped. Endpoint responses have since been confirmed directly against the live API, which changed the approach for the better — Spare's **Ridership Export** endpoint is a pre-joined, flattened dataset that covers most of what we need in one pull, cutting down significantly on manual joins.

**Sources:** Spare support thread with Michelle Hong (Spare), Aug 6–7, 2026; live API response samples confirmed Aug 7, 2026.

---

## 1. Authentication

**Flow:** OAuth 2.0 Authorization Code

| Item | Value |
|---|---|
| Authorize URL | `https://platform.sparelabs.com/app/authorize` |
| Token URL | `https://api.sparelabs.com/v1/app/oauth/token` |
| Scopes | *(not yet captured — paste when available; needed to confirm coverage of requests/duties/slots/routes/stops/exports read scopes)* |

An API key is also available (confirmed in hand) — **do not commit it or paste it into any doc/chat.** Store as an Azure Function App setting / Key Vault secret, e.g. `SPARE_API_KEY`, and reference by name in code (`process.env.SPARE_API_KEY`).

**Confirmed API host:** `https://api.us.sparelabs.com/v1` — use this consistently across all ingestion Functions. (Earlier draft endpoints were shown at `api.sparelabs.com`; that was the wrong host for MVTA's account — swap to the `api.us.` subdomain below.)

---

## 2. Confirmed Endpoints

| # | Endpoint | Method | Confirmed URL | Role in this build |
|---|---|---|---|---|
| 1 | Requests | GET | `https://api.us.sparelabs.com/v1/requests` *(path assumed — not yet pasted, confirm)* | Trip-level raw data (superseded as primary source by Ridership Export, see §3) |
| 2 | Duties | GET | `https://api.us.sparelabs.com/v1/duties` ✅ | Driver/vehicle shift records; fallback source for garage departure |
| 3 | Slots | GET | `https://api.us.sparelabs.com/v1/slots` ✅ | Per-leg schedule records within a duty (start location, pickup, dropoff, etc.) — **primary source for garage departure and Missed Trip condition 2** |
| 4 | Driver Operations | — | **Not found / not confirmed to exist as a separate endpoint.** Not pursuing further — Slots (`type: startLocation`) covers this need instead. | — |
| 5 | Routes | GET | `https://api.us.sparelabs.com/v1/routes/{id}` ✅ (also confirm list variant `GET /v1/routes` for bulk ingestion) | Published fixed-route timetable (`timeTable[]`), stop sequence, cross-check source |
| 6 | Stops | GET | `https://api.us.sparelabs.com/v1/stops` ✅ | Stop name/location/zone lookup table (reference data only, not schedule timestamps) |
| 7 | Ridership Export | GET | `https://api.us.sparelabs.com/v1/exports/ridership` ✅ | **Primary ingestion source** — pre-joined, flattened trip+duty+OTP data |

---

## 3. Key Finding: Use the Ridership Export as the Primary Source

The Ridership Export returns one flattened row per trip with Requests + Duties + OTP fields already joined, including:

- `pickupLatenessSeconds`, `dropoffLatenessSeconds`, `relevantLatenessSeconds` — pre-calculated, no manual subtraction needed for Missed Trip conditions 1 and 3
- `pickupOTPWindowStart`/`pickupOTPWindowEnd`, `dropoffOTPWindowStart`/`dropoffOTPWindowEnd` — Spare's own OTP window (confirm whether this matches MVTA's 30-minute standard or differs)
- `tripWaitSeconds` — pre-calculated wait time (also present as `metrics.waitTime` on the raw Requests object)
- `dutyId`, `dutyIdentifier`, `driverId`, `driverName`, `vehicleLicensePlate` — duty/driver/vehicle context already joined, no separate Duties join needed for reporting
- `statusChangeCancelledTime`, `statusChangeCompletedTime`, `cancellationFault`, `cancellationReason` — status lifecycle already flattened
- `originalScheduledPickupTime`/`originalScheduledDropoffTime` vs. current `scheduledPickupTime`/`scheduledDropoffTime` — handles rescheduled trips
- `pickupZoneName`/`dropoffZoneName`, `pickupGroupName`/`dropoffGroupName` — zone context (ties to Stops `zoneId`)

**What it does NOT cover** (still need separate pulls):
- "Next scheduled departure on the same duty" for Missed Trip condition 2 → **Slots**
- Garage departure/pull-out time → **Slots** (`type: startLocation` record per duty)

**Open item:** confirm Ridership Export's query params (date range filter, pagination via `limit`/`skip`, incremental sync support) before finalizing the ingestion Function — not yet confirmed whether this is a one-time bulk pull or supports scheduled incremental sync.

---

## 4. Field Reference (confirmed field names, camelCase)

### Ridership Export (primary source)
`id`, `createdAtTime`, `originalRequestedPickupTime`, `requestedPickupTime`, `originalScheduledPickupTime`, `scheduledPickupTime`, `pickupOTPWindowStart`, `pickupOTPWindowEnd`, `originalScheduledDropoffTime`, `scheduledDropoffTime`, `dropoffOTPWindowStart`, `dropoffOTPWindowEnd`, `pickupArrivedTime`, `dropoffArrivedTime`, `statusChangeArrivingTime`, `statusChangeInProgressTime`, `statusChangeCancelledTime`, `statusChangeCompletedTime`, `pickupLatenessSeconds`, `dropoffLatenessSeconds`, `relevantLatenessSeconds`, `tripWaitSeconds`, `tripDurationSeconds`, `status`, `dutyId`, `dutyIdentifier`, `driverId`, `driverName`, `vehicleIdentifier`, `vehicleLicensePlate`, `serviceId`, `serviceName`, `cancellationFault`, `cancellationReason`, `pickupZoneName`, `dropoffZoneName`

### Slots (for garage departure + condition 2)
`id`, `dutyId`, `type` (enum incl. `startLocation` — full enum list not yet confirmed, likely also `pickup`/`dropoff`/`endLocation`/`break`), `requestId`, `scheduledTs`, `startedTs`, `arrivedTs`, `completedTs`, `scheduledAddress`, `scheduledStopId`

### Duties (fallback for garage departure)
`id`, `identifier`, `driverId`, `vehicleId`, `startRequestedTs`, `endRequestedTs`, `status`, `metrics.firstSeenInServiceAreaTs`, `metrics.lastSeenInServiceAreaTs`, `scheduleLegs[]` *(empty in sample — confirm whether this duplicates Slots)*

### Routes (cross-check / stop sequence)
`id`, `name`, `stops[]` (`name`, `location`, `slackSeconds`), `days[]`, `startTimes[]`, `timeTable[]` (`dayOfWeek`, `startTime`, `times[]`)

### Stops (reference lookup only)
`id`, `code`, `name`, `location`, `zoneId`, `zoneIds[]`, `isTransitHub`, `isVisibleToRiderApp`, `isEnabled`, `wheelchairBoarding`

---

## 5. Azure SQL Schema

### 5.1 Raw ingestion tables

```sql
CREATE TABLE spare_ridership_export (
    request_id                  NVARCHAR(64)     NOT NULL PRIMARY KEY,
    duty_id                     NVARCHAR(64)     NULL,
    duty_identifier              NVARCHAR(64)     NULL,
    driver_id                    NVARCHAR(64)     NULL,
    driver_name                  NVARCHAR(128)    NULL,
    vehicle_identifier            NVARCHAR(64)     NULL,
    vehicle_license_plate         NVARCHAR(32)     NULL,
    service_id                   NVARCHAR(64)     NULL,
    service_name                 NVARCHAR(128)    NULL,
    status                       NVARCHAR(32)     NOT NULL,
    created_at_time                DATETIME2(0)     NULL,
    original_scheduled_pickup_time DATETIME2(0)    NULL,
    scheduled_pickup_time          DATETIME2(0)     NULL,
    pickup_otp_window_start        DATETIME2(0)     NULL,
    pickup_otp_window_end          DATETIME2(0)     NULL,
    original_scheduled_dropoff_time DATETIME2(0)   NULL,
    scheduled_dropoff_time         DATETIME2(0)     NULL,
    dropoff_otp_window_start       DATETIME2(0)     NULL,
    dropoff_otp_window_end         DATETIME2(0)     NULL,
    pickup_arrived_time            DATETIME2(0)     NULL,
    dropoff_arrived_time           DATETIME2(0)     NULL,
    status_change_cancelled_time   DATETIME2(0)     NULL,
    status_change_completed_time   DATETIME2(0)     NULL,
    pickup_lateness_sec            INT              NULL,
    dropoff_lateness_sec           INT              NULL,
    relevant_lateness_sec          INT              NULL,
    trip_wait_sec                  INT              NULL,
    trip_duration_sec              INT              NULL,
    cancellation_fault             NVARCHAR(32)     NULL,
    cancellation_reason            NVARCHAR(64)     NULL,
    pickup_zone_name               NVARCHAR(128)    NULL,
    dropoff_zone_name              NVARCHAR(128)    NULL,
    ingested_at                    DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload                    NVARCHAR(MAX)    NULL
);
CREATE INDEX IX_ridership_duty_id ON spare_ridership_export(duty_id);
CREATE INDEX IX_ridership_scheduled_pickup ON spare_ridership_export(scheduled_pickup_time);

CREATE TABLE spare_slots (
    slot_id              NVARCHAR(64)     NOT NULL PRIMARY KEY,
    duty_id              NVARCHAR(64)     NOT NULL,
    request_id           NVARCHAR(64)     NULL,
    type                 NVARCHAR(32)     NOT NULL,   -- 'startLocation' | 'pickup' | 'dropoff' | 'endLocation' | etc.
    scheduled_ts          DATETIME2(0)     NULL,
    started_ts            DATETIME2(0)     NULL,
    arrived_ts             DATETIME2(0)     NULL,
    completed_ts           DATETIME2(0)     NULL,
    scheduled_stop_id      NVARCHAR(64)     NULL,
    ingested_at             DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload             NVARCHAR(MAX)    NULL
);
CREATE INDEX IX_slots_duty_type_scheduled ON spare_slots(duty_id, type, scheduled_ts);

CREATE TABLE spare_duties (
    duty_id                      NVARCHAR(64)     NOT NULL PRIMARY KEY,
    identifier                   NVARCHAR(64)     NULL,
    driver_id                    NVARCHAR(64)     NULL,
    vehicle_id                    NVARCHAR(64)     NULL,
    start_requested_ts             DATETIME2(0)     NULL,
    end_requested_ts               DATETIME2(0)     NULL,
    status                        NVARCHAR(32)     NULL,
    first_seen_in_service_area_ts   DATETIME2(0)     NULL,  -- fallback proxy for garage departure
    last_seen_in_service_area_ts    DATETIME2(0)     NULL,
    ingested_at                    DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload                    NVARCHAR(MAX)    NULL
);

CREATE TABLE spare_stops (
    stop_id           NVARCHAR(64)     NOT NULL PRIMARY KEY,
    code              NVARCHAR(32)     NULL,
    name              NVARCHAR(128)    NULL,
    zone_id            NVARCHAR(64)     NULL,
    is_transit_hub      BIT              NOT NULL DEFAULT 0,
    is_enabled          BIT              NOT NULL DEFAULT 1,
    ingested_at          DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    raw_payload           NVARCHAR(MAX)    NULL
);
```

### 5.2 Computed / derived tables

```sql
CREATE TABLE missed_trips (
    request_id                 NVARCHAR(64)     NOT NULL PRIMARY KEY REFERENCES spare_ridership_export(request_id),
    duty_id                     NVARCHAR(64)     NULL,
    is_missed                  BIT              NOT NULL DEFAULT 0,
    condition_1_late_start     BIT              NOT NULL DEFAULT 0,
    condition_2_superseded     BIT              NOT NULL DEFAULT 0,
    condition_3_late_arrival   BIT              NOT NULL DEFAULT 0,
    start_delay_min             INT              NULL,
    arrival_delay_min           INT              NULL,
    superseding_slot_ts         DATETIME2(0)     NULL,
    contributing_garage_delay_min INT            NULL,  -- root-cause link to garage_departure_metrics.variance_min, fixed-route only — see §6.1
    evaluated_at                 DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    calc_version                 NVARCHAR(16)     NOT NULL DEFAULT 'v1'
);
CREATE INDEX IX_missed_trips_is_missed ON missed_trips(is_missed);
CREATE INDEX IX_missed_trips_duty_id ON missed_trips(duty_id);

CREATE TABLE wait_time_metrics (
    request_id            NVARCHAR(64)     NOT NULL PRIMARY KEY REFERENCES spare_ridership_export(request_id),
    wait_time_min          DECIMAL(6,2)     NULL,   -- trip_wait_sec / 60.0
    route_id               NVARCHAR(64)     NULL,
    service_date            DATE             NOT NULL,
    evaluated_at             DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_wait_time_route_date ON wait_time_metrics(route_id, service_date);

CREATE TABLE garage_departure_metrics (
    duty_id                    NVARCHAR(64)     NOT NULL PRIMARY KEY REFERENCES spare_duties(duty_id),
    scheduled_departure_ts       DATETIME2(0)     NULL,
    actual_departure_ts          DATETIME2(0)     NULL,
    departure_source              NVARCHAR(32)     NULL,  -- 'slots_startLocation' | 'duties_firstSeenInServiceArea'
    variance_min                  INT              NULL,
    delay_reason                   NVARCHAR(256)    NULL,  -- operator-entered, not from Spare API — see §9.1
    delay_reason_entered_by         NVARCHAR(64)     NULL,  -- OnBoard user (User Admin role) who entered it
    delay_reason_entered_at          DATETIME2(0)     NULL,
    evaluated_at                   DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
```

> **Note on Wait Time semantics:** Wait Time = requested pickup vs. actual pickup (demand indicator, per Spare's own clarification — NOT a performance metric). Label distinctly from OTP/lateness fields on the dashboard so it isn't misread as a performance stat.

---

## 6. Computation Logic

### 6.1 Missed Trip evaluation
Primary inputs now come from `spare_ridership_export` (pre-calculated lateness) joined to `spare_slots` (for condition 2) — **and now also `garage_departure_metrics`**, since a late garage departure is a common root cause of Condition 1 (late start) on fixed-route service specifically. A duty that pulls out late has a cascading effect on every scheduled stop downstream of it for that run, which is exactly the scenario MVTA's fixed-route standard (and this Missed Trip definition) is meant to catch — this ties the Garage Departure widget directly into Missed Trip reporting rather than leaving them as two disconnected metrics.

```
FOR each row in spare_ridership_export (date range batch):
    -- Condition 1: late start / no-show / cancelled
    IF status IN ('cancelled') OR status_change_cancelled_time IS NOT NULL:
        condition_1 = TRUE
    ELSE IF pickup_lateness_sec IS NOT NULL:
        start_delay_min = pickup_lateness_sec / 60
        condition_1 = start_delay_min > 30

    -- Garage departure linkage (fixed-route only)
    IF row.service_type = 'fixedRoute' (or equivalent flag/service_id classification, see Open Item below):
        garage_delay = SELECT variance_min FROM garage_departure_metrics WHERE duty_id = row.duty_id
        IF garage_delay IS NOT NULL AND garage_delay > 0:
            contributing_garage_delay_min = garage_delay
            -- surfaced on the trip record for root-cause reporting, not a 4th trigger condition —
            -- the trip is still evaluated on conditions 1-3 above; this just explains *why* when condition_1 fires

    -- Condition 2: superseded by next scheduled departure on same duty
    next_slot = SELECT MIN(scheduled_ts) FROM spare_slots
                WHERE duty_id = row.duty_id
                AND type = 'pickup'
                AND scheduled_ts > row.scheduled_pickup_time
    IF next_slot exists:
        gap_min = DATEDIFF(MINUTE, row.scheduled_pickup_time, next_slot)
        IF gap_min < 30 AND pickup_arrived_time > next_slot:
            condition_2 = TRUE
            superseding_slot_ts = next_slot

    -- Condition 3: late arrival
    IF dropoff_lateness_sec IS NOT NULL:
        arrival_delay_min = dropoff_lateness_sec / 60
        condition_3 = arrival_delay_min >= 30

    is_missed = condition_1 OR condition_2 OR condition_3

    UPSERT INTO missed_trips (..., contributing_garage_delay_min)
```

**Design choice, worth confirming:** garage departure delay is treated as a *contributing factor/root cause* surfaced alongside a missed trip, not as its own 4th trigger condition — MVTA's definition is explicitly three conditions, so a late-departing duty that still recovers and starts trips within 30 minutes should NOT be auto-flagged missed just because the garage departure was late. This keeps the two metrics connected for reporting/root-cause purposes without silently changing what counts as "missed" per the agreed standard.



**Open item:** confirm Spare's `pickupOTPWindowStart`/`End` and `dropoffOTPWindowStart`/`End` don't already encode a usable version of conditions 1/3 — could simplify further if their OTP window matches the 30-minute standard.

### 6.2 Wait Time evaluation

```
wait_time_min = trip_wait_sec / 60.0   -- direct from Ridership Export, no manual timestamp math needed
```
Exclude/flag rows with null `pickup_arrived_time` (never picked up) — show completion rate alongside the mean, don't silently drop from the average.

### 6.3 Garage Departure

```
-- Primary: Slots record where type = 'startLocation' for the duty
actual_departure_ts = (SELECT started_ts FROM spare_slots WHERE duty_id = @duty_id AND type = 'startLocation')
scheduled_departure_ts = (SELECT scheduled_ts FROM spare_slots WHERE duty_id = @duty_id AND type = 'startLocation')
departure_source = 'slots_startLocation'

-- Fallback if no startLocation slot exists for the duty:
IF actual_departure_ts IS NULL:
    actual_departure_ts = spare_duties.first_seen_in_service_area_ts
    departure_source = 'duties_firstSeenInServiceArea'

variance_min = DATEDIFF(MINUTE, scheduled_departure_ts, actual_departure_ts)
```

---

## 7. Ingestion Jobs (Azure Functions — TypeScript, matching existing OnBoard pattern)

| Function | Trigger | Source | Target table |
|---|---|---|---|
| `ingestSpareRidershipExport` | Timer (e.g., every 15–30 min) | Ridership Export endpoint | `spare_ridership_export` |
| `ingestSpareSlots` | Timer (daily + intraday refresh) | Slots endpoint | `spare_slots` |
| `ingestSpareDuties` | Timer (daily) | Duties endpoint | `spare_duties` |
| `ingestSpareStops` | Timer (weekly — reference data, rarely changes) | Stops endpoint | `spare_stops` |
| `evaluateMissedTrips` | Timer, runs after `ingestSpareRidershipExport` + `ingestSpareSlots` complete | `spare_ridership_export` + `spare_slots` | `missed_trips` |
| `evaluateWaitTime` | Timer, runs after `ingestSpareRidershipExport` | `spare_ridership_export` | `wait_time_metrics` |
| `evaluateGarageDeparture` | Timer, runs after `ingestSpareSlots` + `ingestSpareDuties` | `spare_slots` + `spare_duties` | `garage_departure_metrics` |

All jobs idempotent (upsert on primary key); log run summary (rows processed, rows flagged) to existing OnBoard operational logging pattern. API key read from `SPARE_API_KEY` app setting / Key Vault reference — never hardcoded.

---

## 8. Ridership Counters (Daily / Weekly / Monthly / Running)

New requirement: OCC and other stakeholders need real-time-visible ridership counts, not just the missed-trip/wait-time/garage-departure metrics above. This is a simpler aggregation problem — completed trip counts from `spare_ridership_export`, rolled up at multiple time grains.

**Definition:** a "ridership count" = count of trips where `status_change_completed_time IS NOT NULL` (i.e., actually completed, not just requested/scheduled). Confirm with OCC whether cancelled/no-show trips should be excluded entirely or shown as a separate "no-show count" alongside ridership — recommend excluding from the core ridership number but surfacing no-shows as a secondary stat, consistent with how Missed Trips are already broken out.

### 8.1 Schema

```sql
CREATE TABLE ridership_counts_daily (
    service_date         DATE             NOT NULL,
    route_id              NVARCHAR(64)     NULL,   -- NULL = system-wide total row
    service_id            NVARCHAR(64)     NULL,
    completed_count        INT              NOT NULL DEFAULT 0,
    no_show_count          INT              NOT NULL DEFAULT 0,
    cancelled_count         INT              NOT NULL DEFAULT 0,
    evaluated_at             DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (service_date, route_id, service_id)
);
CREATE INDEX IX_ridership_daily_date ON ridership_counts_daily(service_date);
```

Weekly and monthly figures are **derived by rolling up `ridership_counts_daily`** (SUM by ISO week / calendar month) rather than maintaining separate tables — avoids duplicate aggregation logic and keeps a single source of truth. Use a SQL view or the API layer to compute these on read:

```sql
CREATE VIEW ridership_counts_weekly AS
SELECT
    DATEPART(ISO_WEEK, service_date) AS iso_week,
    YEAR(service_date) AS year,
    route_id,
    service_id,
    SUM(completed_count) AS completed_count,
    SUM(no_show_count) AS no_show_count,
    SUM(cancelled_count) AS cancelled_count
FROM ridership_counts_daily
GROUP BY DATEPART(ISO_WEEK, service_date), YEAR(service_date), route_id, service_id;

CREATE VIEW ridership_counts_monthly AS
SELECT
    MONTH(service_date) AS month,
    YEAR(service_date) AS year,
    route_id,
    service_id,
    SUM(completed_count) AS completed_count,
    SUM(no_show_count) AS no_show_count,
    SUM(cancelled_count) AS cancelled_count
FROM ridership_counts_daily
GROUP BY MONTH(service_date), YEAR(service_date), route_id, service_id;
```

### 8.2 "Running counter" (real-time today count)

This is the one piece that can't come from the daily rollup table, since today isn't finalized yet. Two implementation options — pick based on how "real-time" OCC actually needs this to feel:

**Option A — Poll-and-cache (simpler, recommend starting here):**
- `evaluateRidershipCounts` Function runs frequently (every 2–5 min) during service hours, counts today's completed trips from `spare_ridership_export` where `service_date = today`, and upserts into `ridership_counts_daily` for the current date
- Dashboard polls this row on a short interval (e.g., every 30–60 sec) — "real-time" to the OCC user within the ingestion lag window
- Low build complexity, reuses the same ingestion pattern as everything else in this spec

**Option B — Live push (only if OCC needs sub-minute accuracy):**
- Requires a push mechanism (Azure SignalR Service or similar) to update the dashboard counter without polling
- Meaningfully more infrastructure for a marginal accuracy gain over Option A — recommend deferring unless OCC explicitly asks for it after seeing Option A in practice

### 8.3 Ingestion job

| Function | Trigger | Source | Target |
|---|---|---|---|
| `evaluateRidershipCounts` | Timer, every 2–5 min during service hours; once daily overnight to finalize prior day | `spare_ridership_export` | `ridership_counts_daily` |

---

## 9. Dashboard Updates (React frontend)

### 9.1 New/updated widgets

**Ridership Counters** *(new — for OCC visibility)*
- Prominent running-total tile: "Today's Ridership" — large number, auto-refreshing (see §8.2), system-wide by default with a route filter
- Secondary tiles/toggle: Week-to-date, Month-to-date totals (from the rollup views)
- Small trend sparkline per tile (last 7/30 days) for at-a-glance context
- Secondary stat, smaller/less prominent: no-show count and cancelled count for the same period
- This is the one widget on the dashboard explicitly meant for a wall-mounted/OCC-monitor display, not just analyst drill-down — keep it visually simple and legible at a distance (large numbers, minimal chrome), distinct from the denser Missed Trips/Wait Time tables elsewhere on the page

**Garage Departure Times**
- Match the existing OCC-familiar report format (two sub-tables, mirroring current manual tracking):
  - **Duty Start table:** Driver Name, Driver ID, Duty Scheduled Start Time, Duty Actual Started Time, # of Minutes Delayed, Delay Reason
  - **Vehicle Depart table:** User Report Label, Depart Time Schedule, Depart Time Actual, Vehicle Report Label, # of Minutes Delayed, Delay Reason
- `# of Minutes Delayed` shown as negative-early / positive-late (matching existing convention, e.g. "-9" = 9 min early), sourced from `variance_min` in `garage_departure_metrics`
- Filter: date range, driver, route
- Flag rows exceeding a configurable variance threshold (e.g., >10 min late)
- **Gap — "Delay Reason" is not derivable from Spare's API.** It's operator-entered free text (e.g., "Hot Swap," "Tablet Connection," "Late Check-In," "Radio Issues," "Waiting for AVL to boot up") in the current manual process. Two options:
  1. Add a `delay_reason` editable field directly in the OnBoard UI (User Admin role, OCC-entered) tied to `garage_departure_metrics` by `duty_id` — closest to current workflow
  2. Check whether this is already captured elsewhere in MVTA's systems (dispatch notes, AVL exception logs) that could be ingested instead of manually re-entered
  - Recommend option 1 for initial build — lowest lift, matches existing OCC habit, and can be revisited if a better source surfaces

**Missed Trips**
- Summary tile: count and % of trips flagged missed, by day/week/route
- Breakdown by condition (late start / superseded / late arrival) — a trip can trigger more than one, so use a stacked bar or multi-select breakdown, not a simple pie
- Drill-down table: Request ID, Route, Scheduled Pickup, Actual Pickup, Condition(s) Triggered, Delay (min)
- **Root-cause column (fixed-route trips):** when `contributing_garage_delay_min` is populated, surface it in the drill-down table (e.g., "Late start — duty departed garage 9 min late, see Garage Departure log") with a link/reference back to the corresponding row in the Garage Departure widget, so OCC can trace a missed trip back to its originating delay and reason without cross-referencing two separate reports manually
- Footnote/tooltip showing `calc_version` for traceability if the 3-condition logic changes later

**Mean Wait Time**
- Line/trend chart: mean wait time by day, filterable by route
- Explicit subtitle: "Demand indicator — time between requested and actual pickup. Not a performance metric."
- Secondary stat: % of trips with null `pickup_arrived_time` (never picked up), shown separately from the average

### 8.2 Placement
New "Spare Service Metrics" section/tab alongside the existing OTP Compliance Module and Detour & Closure Board — related to but distinct from OTP exclusion-based compliance reporting.

---

## 10. Open Items / Decisions Needed Before Build

1. **OAuth scopes** — not yet captured; paste when available to confirm coverage of all read scopes needed.
2. **Requests endpoint URL** — assumed `/v1/requests` on the confirmed `api.us.sparelabs.com` host, not yet directly verified (may be moot if Ridership Export fully replaces it as primary source — confirm during build whether raw Requests is still needed for anything Ridership Export doesn't cover).
3. **Ridership Export query params** — confirm date range filtering, pagination (`limit`/`skip`), and whether it supports incremental/delta sync or only full pulls.
4. **Slots `type` enum** — only `startLocation` confirmed from sample data; get the full enum list (likely includes `pickup`, `dropoff`, `endLocation`, `break`) before finalizing condition 2 and garage departure logic.
5. **Duties `scheduleLegs[]`** — empty in sample; confirm whether populated data here duplicates Slots (would let us drop one of the two sources).
6. **Spare's OTP window fields** — check whether `pickupOTPWindowStart/End` and `dropoffOTPWindowStart/End` already encode a 30-minute-equivalent window that could simplify or replace manual condition 1/3 logic.
7. **Missed Trip condition 2 scope** — confirmed as `duty_id`-scoped (matches your "same duty" definition) rather than `route_id`-scoped; flagging once more for final sign-off since it materially changes which trips get flagged.
8. **Historical backfill range** — decide date range for initial backfill before turning on scheduled ingestion.
9. **Threshold configurability** — should the 30-minute thresholds and garage departure variance threshold be hardcoded or admin-configurable (System Admin role) in OnBoard settings?
10. **Ridership count definition** — confirm with OCC whether no-shows/cancellations should be fully excluded from the headline ridership number or shown as a secondary stat (spec currently assumes the latter); also confirm how "real-time" the running counter needs to feel (Option A poll-and-cache vs. Option B live push, §8.2) before committing to either build path.
11. **Delay Reason entry workflow** — confirm this should be manually entered in OnBoard by OCC (User Admin role) per the current process, vs. sourced from an existing dispatch/AVL log if one already captures it; also confirm whether it should be a free-text field or a constrained dropdown (existing samples suggest a fairly small recurring set: Hot Swap, Tablet Connection, Late Check-In, Radio Issues, AVL Boot Delay — a dropdown would make the field more reportable over time).
12. **Fixed-route classification field** — §6.1's garage-departure-to-Missed-Trip linkage is scoped to fixed-route service only, but the exact field/value to test on (`service_type = 'fixedRoute'`, a `serviceId` lookup against the existing Route Classification reference table, or something else in the Ridership Export) hasn't been confirmed against the live schema yet — verify before Claude Code implements the join, since applying this logic to on-demand trips would produce misleading root-cause attributions.
