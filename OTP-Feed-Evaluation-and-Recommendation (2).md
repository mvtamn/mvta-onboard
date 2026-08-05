# OTP Data Feed Evaluation & Recommendation

**Purpose:** Select the Avail OTP data feed for continuous ingestion into MVTA OnBoard (Azure-hosted) to support monthly OTP compliance checks with stop-level filtering.

**Requirements driving the decision:**
1. Continuous / recurring ingestion (not a one-off manual export)
2. Monthly compliance evaluation cadence
3. Ability to filter/report by specific stops
4. Ingested and stored via Azure (Function App + SQL)

---

---

## Configuration Values (Confirmed)

| Parameter | Value | Applies to |
|---|---|---|
| `{Property}` | `MVTA` | All Avail feeds referenced in this document (OTP, Missed Trips, AVL Reports) — replaces the `ACME` placeholder used in the API spec examples |

---

## Candidate Feeds Reviewed

Five data sources were evaluated: four Avail OTP APIs and one raw CSV export.

| Feed | API Operation ID | Grain | Time Handling | Stop-Level? | Verdict |
|---|---|---|---|---|---|
| OTP By Route/Day/Hour | `otp-by-route-day-hour` | Route × DayOfWeek × HourOfDay | Custom Start/End Date range | **No** — no StopID field | Ruled out — cannot filter by stop |
| OTP By Route/Stop/Hour | (route-stop-hour) | Stop × Route × HourOfDay | Auto-aggregates the whole month containing the service date passed | Yes | Viable but loses DayOfWeek breakdown |
| OTP By Route/Stop/Day/Hour | `otp-by-route-stop-day-hour` | Stop × Route × Date × Hour (includes lat/long, direction) | Custom Start/End Date range | Yes | Best for drill-down, not for the recurring monthly job (heavy payload, requires app-side monthly rollup) |
| **OTP Monthly By Route/Stop/Day of Week** | `otp-by-month-route-stop-day-of-week` | Stop × Route × DayOfWeek | **Auto-aggregates the whole month** containing the service date passed | Yes | **Recommended primary feed** |
| Raw CSV export | n/a | Individual stop-event (one row per depart/arrive) | Manual export | Yes (Depart Stop Id) | Not viable as a continuous feed |

---

## Recommendation: Primary Feed

**`OtpByRouteStopDayAgg` — "OTP Monthly By Route/Stop/Day of Week"**

```
GET /{Property}/{Service Date}/{Early Threshold}/{Late Threshold}/{Early Outlier}/{Late Outlier}/{Show Missed Stops}/{Include Outliers}/{Show Detours}
```

Base URL (production): `https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1`

*(Note: the API spec document references `https://avail360-test.myavail.cloud/OtpByRouteStopDayAgg/v1` — that's the test/sandbox host. Confirm which environment the Azure Function should point to per deployment stage — `avail360-test` for dev/staging, `avail360-api` for production.)*

### Why this feed fits

- **Auto-aggregates to the month.** Pass any service date (`MM-DD-YYYY`) and the API returns the entire month containing that date — no date-range math required, no risk of pulling a partial month.
- **Native stop-level fields.** `StopID`, `StopInternetName`, `RouteID`, `RouteReportLabel` are all present, so filtering to specific stops (mapping to the OTP Compliance Module's stop-level exclusion logic) is a direct query/filter rather than a join across feeds.
- **DayOfWeek is preserved despite being a monthly aggregate.** This matters because Weekday / Saturday / Sunday service levels typically carry different OTP standards — a distinction the plain Route/Stop/Hour feed does not preserve.
- **Response fields cover the full compliance calculation:** `PercentEarly`, `PercentOntime`, `PercentLate`, `PercentNotOntime`, `PercentMissed`, plus raw counts (`Early`, `Ontime`, `Late`, `Missed`, `ActualDepartures`, `Total`) — everything needed for departure-adherence scoring against Attachment G thresholds.

### Example response shape

```json
{
  "DayOfWeek": "Wed",
  "StopID": 3242,
  "StopInternetName": "29th Ave S and 18th St S",
  "RouteReportLabel": "MCC  - Magic Cit",
  "RouteID": 90,
  "PercentEarly": 0.0407,
  "PercentOntime": 0.2733,
  "PercentLate": 0.1919,
  "PercentNotOntime": 0.2384,
  "PercentMissed": 0.4884,
  "Early": 7,
  "Ontime": 47,
  "Late": 33,
  "Missed": 84,
  "ActualDepartures": 88,
  "Total": 172
}
```

---

## Suggested Azure Ingestion Pattern

- **Trigger:** Timer-triggered Azure Function, run on a schedule anchored to monthly close-out (e.g., first business day of the month, pulling the prior month via a service date within that month).
- **Call:** `GET /{Property}/{ServiceDate}/1/5/{EarlyOutlier}/{LateOutlier}/0/1/1`
  - Early Threshold and Late Threshold are effectively fixed at `1` and `5` per the API schema (enum-constrained).
  - Early Outlier / Late Outlier — confirm whether these need to be configurable per compliance cycle or can be hardcoded (open question below).
- **Storage:** Persist to Azure SQL keyed on `(RouteID, StopID, DayOfWeek, ServiceMonth)` so the compliance dashboard/reporting layer queries this table directly rather than re-hitting the Avail API per request.
- **Auth:** `Ocp-Apim-Subscription-Key` header (or `subscription-key` query param) per the API's security scheme.

---

## Secondary / Supporting Feeds

Keep these available for on-demand use, not as the primary recurring pull:

- **OTP By Route/Stop/Day/Hour** (`otp-by-route-stop-day-hour`) — date-range, hour-level, includes lat/long and direction. Use this when a route/stop is flagged by the monthly aggregate and you need to identify which specific trips or hours drove the miss, or to visualize detours on a map.
- **Raw CSV export** — trip-level actual vs. scheduled timestamps down to the second. Retain as the audit-of-last-resort source if a vendor disputes a monthly compliance number. Not suitable as a polled feed (large payload, no API endpoint — manual export only).

## Ruled Out

- **OTP By Route/Day/Hour** — no `StopID` field anywhere in the schema, so it cannot satisfy the stop-level filtering requirement regardless of its other strengths.

---

---

# Missed Trips Feed Evaluation (Fixed Route)

**Purpose:** Select the Avail Missed Trips feed for continuous ingestion to support monthly compliance evaluation of potential missed trips on fixed-route service, with stop-level filtering.

**Note:** Only fixed-route missed-trip feeds were provided for this evaluation. On-demand (paratransit/microtransit) missed-trip compliance tracking will need its own feed — flagged as an open question below.

## Candidate Feeds Reviewed

Unlike the OTP feeds, these return **individual missed-trip incident records** rather than aggregated percentages — each row is a specific departure/arrival/trip that was missed.

| Feed | API Operation ID | Grain | Time Handling | Stop-Level? | Route Name Fields? | Filter Controls |
|---|---|---|---|---|---|---|
| Missed Trips By Route/Stop/Hour | `missed-trips-by-route-stop-hour` (base) / `...-with-filters` (filtered variant) | Departure Stop × Arrival Stop × Route × HourOfDay | Auto-aggregates the whole month containing the service date passed; **no explicit CalendarDate field on records** | Yes (Departure & Arrival StopID) | No — RouteID only | Filtered variant exposes `Full Trip Only` / `Include Deadheads`, but both are enum-locked to a single value (`1` and `0` respectively) in the schema as documented — effectively not adjustable via this endpoint |
| **Missed Trips By Route/Stop/Day** | `missed-trips-by-route-stop-day` | Departure Stop × Arrival Stop × Route × Date | **Custom Start/End Date range**, with `CalendarDate` on every record | Yes (Departure & Arrival StopID) | Yes — `RouteDesc`, `RouteInternetName` | `Full Trip Only` and `Include Deadheads` are genuinely toggleable (`0`/`1` both valid) |

## Recommendation: Primary Feed

**`MissedTripsByRouteStopDay` — "Missed Trips By Route/Stop/Day"**

```
GET /{Property}/{Start_Date}/{End_Date}/{Full Trip Only}/{Include Deadheads}
```

Base URL (production): `https://avail360-api.myavail.cloud/MissedTripsByRouteStopDay/v1`

*(Spec doc references the `avail360-test` host — same environment note as the OTP feed applies here.)*

### Why this feed fits

- **Explicit date range control with a real `CalendarDate` per record.** For a monthly compliance job, this means you can bound the pull precisely to the reporting month (or re-pull a prior month for dispute resolution) instead of relying on "whichever month contains this date" like the Hour variant.
- **Both compliance filters are actually functional here.** `Full Trip Only` (0 = count a trip if either the departure or arrival stop was missed; 1 = only count it if the entire trip — both ends — was missed) and `Include Deadheads` (0/1) are real toggles on this endpoint. On the Hour feed, the equivalent filtered endpoint has these locked to a single enum value each, which limits its usefulness for a configurable compliance rule.
- **Route name fields included** (`RouteDesc`, `RouteInternetName`) — one less lookup/join needed when generating compliance reports or dashboards.
- **Stop-level filtering** on both `DepartureStopID` and `ArrivalStopID` — supports the same stop-exclusion logic used in the OTP Compliance Module.

### Compliance framing worth deciding up front

- For Attachment G–style scoring, you'll likely want **`Include Deadheads = 0`** (exclude non-revenue moves) so deadhead runs don't get counted against the vendor.
- Whether to use **`Full Trip Only = 1`** (strict — entire trip missed) vs. `0` (broader — either end missed) depends on how Attachment G defines a "missed trip" for penalty purposes. Worth confirming against the contract language before hardcoding the filter value in the Function.

### Example response shape

```json
{
  "DepartureStopID": 3600,
  "DepartureStopName": "West Terminus",
  "ArrivalStopID": 3617,
  "ArrivalStopName": "WoodlawnTerminu",
  "RouteID": 100,
  "RouteDesc": "BX-Birmingham Express",
  "RouteInternetName": "BX-Birmingham Express",
  "CalendarDate": "2025-08-12T00:00:00.0000000+00:00",
  "DepartureMissed": 1,
  "ArrivalMissed": 1,
  "EntireTripMissed": 1,
  "DepartureTripStartTime": null
}
```

## Secondary / Supporting Feed

- **Missed Trips By Route/Stop/Hour** (`missed-trips-by-route-stop-hour`) — keep for hour-of-day pattern analysis once a route/stop is flagged by the monthly compliance pull (e.g., confirming whether misses cluster around a specific time of day, which can support root-cause conversations with the contractor). Not suited as the primary compliance feed given the locked filter enums and lack of a per-record date field.

## Suggested Azure Ingestion Pattern

- **Trigger:** Same Timer-triggered Function pattern as the OTP feed — run at monthly close-out, pulling `Start_Date`/`End_Date` bounding the prior calendar month.
- **Call:** `GET /{Property}/{Start_Date}/{End_Date}/0/0` (or `1/0` if strict full-trip-only scoring is confirmed) — see compliance framing above before finalizing these two values.
- **Storage:** Persist to Azure SQL keyed on `(RouteID, DepartureStopID, ArrivalStopID, CalendarDate)`, incident-level — this is event-grain data, not pre-aggregated, so the compliance rollup (count/percentage of missed trips per stop per month) happens in your app layer, not the API response.
- **Auth:** Same `Ocp-Apim-Subscription-Key` header pattern as the OTP feeds.

---

# Fixed Route vs. Special Event Bus Routing

**The problem:** the sample record you pasted confirms the core issue —

```json
{
  "DepartureStopID": 1001,
  "RouteID": 6,
  "HourOfDay": 13,
  ...
}
```

**None of the Missed Trips (or OTP) feeds carry a field that classifies a `RouteID` as fixed-route vs. special event.** `RouteID` is just a number; there's no `RouteType`, `ServiceCategory`, or similar flag anywhere in either feed's schema. Avail returns whatever RouteIDs exist for the property with no indication of which are your CAD-tracked fixed routes and which are ad hoc event service.

That means **this can't be solved by filtering the API response alone** — the classification has to happen in your app, against a source of truth you control.

## Recommended Approach: Route Classification Reference Table

Build a small reference table in Azure SQL that MVTA OnBoard owns and maintains — this becomes the single place that decides "is this RouteID fixed route or special event," and every downstream consumer (OTP compliance, missed trips compliance, the event module) reads from it rather than guessing from the feed.

```sql
CREATE TABLE dbo.RouteClassification (
    RouteID INT NOT NULL PRIMARY KEY,
    RouteCategory VARCHAR(20) NOT NULL,   -- 'FixedRoute' | 'SpecialEvent' | 'OnDemand'
    RouteLabel VARCHAR(100) NULL,          -- friendly name, e.g. "Vikings Game Shuttle"
    EffectiveStartDate DATE NULL,          -- optional: if event RouteIDs get reused across events
    EffectiveEndDate DATE NULL,
    IsActive BIT NOT NULL DEFAULT 1
);
```

### Pipeline flow

1. **Ingest** — Azure Function pulls the raw feed (Missed Trips or OTP) as already documented above.
2. **Classify** — join each incoming record on `RouteID` against `RouteClassification`.
3. **Fork:**
   - `RouteCategory = 'FixedRoute'` → routes into the existing CAD-tracked compliance pipeline (the OTP Compliance Module / Attachment G scoring tables already documented in this file).
   - `RouteCategory = 'SpecialEvent'` → routes into a **separate Event Module schema** (e.g., `dbo.EventMissedTrips`, `dbo.EventOtp`) that's exposed through its own API/UI surface — kept out of Attachment G compliance scoring entirely, since event service isn't part of the fixed-route contractor's regular obligation.
   - Any `RouteID` with **no match** in the table → land it in a `dbo.UnclassifiedRoutes` staging table rather than silently dropping it or silently defaulting it to fixed route. This is your safety net for new event RouteIDs that haven't been registered yet.
4. **Maintain** — whenever a special event is scheduled, someone (Ty or a User Admin) adds/updates the `RouteClassification` row before the event runs, so the Function classifies it correctly on the next pull. This is a manual/light-touch admin step, not something the Function can infer on its own.

### Why the reference table beats trying to pattern-match on `RouteReportLabel`

The OTP feeds do include a `RouteReportLabel` (e.g., "Operator Shuttle", "MCC - Magic Cit") that could theoretically hint at event service via naming convention, but:
- The Missed Trips feeds you're filtering here **don't include that field at all** — only `RouteID`.
- Relying on string-matching a label is fragile (typos, inconsistent naming, truncation like "MCC - Magic Cit" above) and would need to be re-validated every time someone names a new event route.

A RouteID-keyed lookup table is deterministic and auditable — worth the small admin overhead.

### One thing worth checking with Avail before building this

It's worth a quick check with Avail/your CAD admin console: does Avail already tag routes internally with a service type (something used to separate fixed-route from charter/event work order in their own system, even if it's not exposed in these particular API responses)? If so, it may be exportable or queryable directly, which would let `RouteClassification` be populated automatically instead of manually — worth 10 minutes of checking before committing to a fully manual table.

---

# Live Vehicle Tracking Feed Evaluation (AVL Reports) — Event Bus Monitoring

**Purpose:** Ty confirmed this feed's use case — **monitoring special event buses specifically**, for the Event Module. Fixed-route vehicles are already tracked via the existing CAD system, so this pipeline doesn't need to power a fixed-route view at all; its whole job is surfacing live position for event service.

That simplifies the design from what was drafted before: instead of a two-way fork feeding both a CAD view and an Event Module view, this is a **single-purpose ingestion path that filters to event buses only and discards the rest.**

## Feed characteristics

```
GET /{Property}/{Start DateTime}/{End DateTime}
```

Base URL (production): `https://avail360-api.myavail.cloud/AVLReports/v1`

| Field | Notes |
|---|---|
| `Vehicle` | Vehicle/bus number — not present in any OTP or Missed Trips feed; useful as a secondary classifier (see below) |
| `Timestamp` | Per-ping timestamp, property timezone |
| `Route` | Numeric RouteID — same bare identifier as the other feeds, same classification problem applies |
| `Block`, `Run`, `Trip` | Scheduling identifiers — useful for joining back to schedule data if the Event Module ever needs it |
| `Latitude`, `Longitude`, `Heading`, `Direction` | Raw position/orientation — this is what actually renders a moving vehicle on a map |

**This is a fundamentally different feed shape than everything reviewed so far.** OTP and Missed Trips are batch/aggregate feeds meant for monthly compliance rollups. AVL Reports is raw, high-frequency vehicle telemetry — it has no `StopID` and no performance metrics at all. Its job is live position, not compliance scoring.

**Critical constraint: 24-hour maximum window per call.** You cannot pull a month at a time here. This feed is built for short, frequent polling, not periodic batch ingestion.

## Recommended approach: event-bus-only real-time ingestion path

This doesn't touch the monthly compliance pipeline at all — it's a standalone, real-time path dedicated to the Event Module:

- **Trigger:** Timer-triggered Azure Function on a short interval (e.g., every 1–2 minutes, matched to however often Avail actually refreshes AVL data), pulling a rolling window (e.g., "now minus 5 minutes" to "now") rather than the full 24-hour max.
- **Filter on ingest:** join each incoming ping's `Route` against `RouteClassification` (the same table from the Missed Trips/OTP sections) and **keep only `SpecialEvent` matches** — fixed-route pings are discarded at this stage rather than stored, since CAD already owns that view and there's no reason to duplicate it here.
- **Storage:** Two tables, scoped to event vehicles only —
  - `dbo.EventVehicleCurrentPosition` — upsert keyed on `Vehicle`, latest ping only, powers the Event Module's live map.
  - `dbo.EventVehiclePositionHistory` — append-only, if you want playback/trail for a given event after the fact (useful for post-event review or a rider complaint about a specific shuttle).
- **No Service Bus fork needed** for this feed specifically — since fixed-route pings never get published in the first place, there's nothing to route between topics. If the Event Module itself needs to notify other parts of the app of position updates, a single `event-vehicle-positions` topic is enough.

## Classification note carried over from the Missed Trips/OTP sections

`Route` here has the same problem as `RouteID` elsewhere — just a number, no service-type flag — so this pipeline depends on the same `RouteClassification` table staying current. Since this feed is now the **primary consumer that cares about that table in real time**, it raises the stakes on keeping it accurate: a RouteID added to `RouteClassification` late (after an event has already started running) means that event's buses won't show up in the Event Module until the table is updated. Worth deciding whether route setup for an event includes registering it in `RouteClassification` as a required step in the event-prep checklist, not an afterthought.

As noted before, `Vehicle` (bus number) is available directly on this feed and could serve as a fallback/secondary classifier — useful if event buses ever run under a RouteID that's ambiguous or shared with regular service on the same day.

---

## Open Questions Before Implementation

1. **(OTP feed)** Do Early Outlier / Late Outlier thresholds need to be configurable per compliance cycle (e.g., stored as app config, adjustable by an admin), or can they be hardcoded constants in the Function?
2. **(Missed Trips feed)** Should `Full Trip Only` be `1` (strict) or `0` (either end missed) per Attachment G's definition of a missed trip? Confirm against contract language.
3. **(Missed Trips feed — on-demand)** No on-demand/paratransit missed-trip feed was provided in this round. If Avail exposes an equivalent endpoint for demand-response service, it should be evaluated separately — fixed-route and on-demand compliance likely need distinct scoring logic and possibly distinct storage tables.
4. **(Route classification)** Does Avail/the CAD system already tag RouteIDs by service type internally (even if not exposed in these API responses)? If yes, `RouteClassification` could be populated automatically instead of manually maintained. Also confirm whether event RouteIDs are ever reused across different events over time (which would require the `EffectiveStartDate`/`EffectiveEndDate` columns to disambiguate) or whether each event gets a unique, permanent RouteID.
5. **(AVL Reports)** What's Avail's actual AVL refresh cadence? That determines the right polling interval for the Timer Function — polling faster than the source data updates just wastes calls. Also confirm the process for registering a new event's RouteID(s) in `RouteClassification` *before* the event starts running, so its buses aren't missing from the Event Module on event day. And confirm whether Route-based filtering alone is reliable, or a Vehicle-based fallback is needed for cases where event buses share a RouteID with regular service.
