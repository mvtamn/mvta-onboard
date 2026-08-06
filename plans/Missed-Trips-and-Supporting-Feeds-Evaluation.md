# Missed Trips, Route Classification & Live Tracking — Feed Evaluation

Split out from `OTP-Feed-Evaluation-and-Recommendation.md` to keep OTP concerns (compliance scoring, near-real-time/cumulative views) separate from Missed Trips, fixed-route/special-event routing, and live vehicle tracking. Both files share the same Azure/MVTA OnBoard implementation context.

---

## Configuration Values

| Parameter | Value | Applies to |
|---|---|---|
| `{Property}` | `MVTA` | All Avail feeds referenced in this document — replaces the `ACME` placeholder used in the API spec examples |

**Worth verifying, not assuming:** this hasn't been confirmed character-for-character against Avail's actual registered value for this account. See `OTP-Feed-Evaluation-and-Recommendation.md`'s diagnostic section (Step 0) — since Missed Trips shows the same "valid envelope, zero rows" symptom as OTP Monthly, a wrong `{Property}` value would explain both at once, and should be ruled out before assuming either feed has a deeper problem.

---

---

## Endpoint Reference (Exact Path Shapes, Pulled Directly from Avail's OpenAPI Specs)

Given AVL Reports 404'd for months because of a missing path segment, this table exists so every request can be visually diffed against the actual spec rather than reconstructed from memory. Production host is `avail360-api.myavail.cloud`, test/sandbox host is `avail360-test.myavail.cloud`.

### Missed Trips By Route/Stop/Hour — two valid path shapes

```
GET https://avail360-api.myavail.cloud/MissedTripsByRouteStopHour/v1/{Property}/{Service Date}
```
Base call, `operationId: missed-trips-by-route-stop-hour`. Returns the month containing `{Service Date}`, no filters.

```
GET https://avail360-api.myavail.cloud/MissedTripsByRouteStopHour/v1/{Property}/{Service Date}/{Full Trip Only}/{Include Deadheads}
```
Filtered variant, `operationId: missed-trips-for-the-month-by-route-stop-hour-with-filters`. **Note the enum lock flagged earlier in this doc:** the spec documents `Full Trip Only` as enum-restricted to `1` only and `Include Deadheads` to `0` only — even though this is the "with filters" variant, the schema as written doesn't actually let those two values vary. Worth confirming directly with Avail whether that's a documentation error or a real constraint before assuming this endpoint is configurable.

### Missed Trips By Route/Stop/Day — one path shape

```
GET https://avail360-api.myavail.cloud/MissedTripsByRouteStopDay/v1/{Property}/{Start_Date}/{End_Date}/{Full Trip Only}/{Include Deadheads}
```
`operationId: missed-trips-by-route-stop-day`. This is the recommended primary feed above — both filter params are genuinely `0`/`1` here, not enum-locked. `{Start_Date}`/`{End_Date}` accept either `MM-DD-YYYY` or `YYYY-MM-DD` per the spec description — pick one format and use it consistently in the Function rather than relying on the API to be lenient.

### AVL Reports — one path shape

```
GET https://avail360-api.myavail.cloud/AVLReports/v1/{Property}/{Start DateTime}/{End DateTime}
```
This is the exact shape the production 404 bug is missing — confirmed three segments: `{Property}`, `{Start DateTime}`, `{End DateTime}`. **Format is a full datetime, not a date:** `YYYY-MM-DD HH:MI:SS`, e.g. `2026-08-05 14:00:00` — not `2026-08-05`. The current broken code builds `${baseUrl}/${formatDateYyyyMmDd(date)}`, which is missing the `{Property}` segment, missing the second datetime segment entirely, and formats a date-only string where a full datetime is required. All three need fixing, not just the missing segment. 24-hour max window between Start and End.

### Garage Pull Out / Fixed Route Departures — not documented, spec still needed

No OpenAPI spec for this endpoint has been provided to this evaluation. It fails identically to AVL Reports (100% 404, every run), and the same missing-segment hypothesis is the leading candidate — but that's extrapolation from AVL's shape, not a confirmed spec. **Do not rebuild this request from the AVL pattern alone** — get the actual Pullout OpenAPI doc or one confirmed working raw call first, the same way this table was built for every other endpoint here.

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

**The problem:** a sample Missed Trips record confirms the core issue —

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

1. **Ingest** — Azure Function pulls the raw feed (Missed Trips or OTP) as already documented.
2. **Classify** — join each incoming record on `RouteID` against `RouteClassification`.
3. **Fork:**
   - `RouteCategory = 'FixedRoute'` → routes into the existing CAD-tracked compliance pipeline (the OTP Compliance Module / Attachment G scoring tables).
   - `RouteCategory = 'SpecialEvent'` → routes into a **separate Event Module schema** (e.g., `dbo.EventMissedTrips`, `dbo.EventOtp`) that's exposed through its own API/UI surface — kept out of Attachment G compliance scoring entirely, since event service isn't part of the fixed-route contractor's regular obligation.
   - Any `RouteID` with **no match** in the table → land it in a `dbo.UnclassifiedRoutes` staging table rather than silently dropping it or silently defaulting it to fixed route. This is your safety net for new event RouteIDs that haven't been registered yet.
4. **Maintain** — whenever a special event is scheduled, someone (Ty or a User Admin) adds/updates the `RouteClassification` row before the event runs, so the Function classifies it correctly on the next pull. This is a manual/light-touch admin step, not something the Function can infer on its own.

### Why the reference table beats trying to pattern-match on `RouteReportLabel`

The OTP feeds do include a `RouteReportLabel` (e.g., "Operator Shuttle", "MCC - Magic Cit") that could theoretically hint at event service via naming convention, but:
- The Missed Trips feeds don't include that field at all — only `RouteID`.
- Relying on string-matching a label is fragile (typos, inconsistent naming, truncation like "MCC - Magic Cit" above) and would need to be re-validated every time someone names a new event route.

A RouteID-keyed lookup table is deterministic and auditable — worth the small admin overhead.

### One thing worth checking with Avail before building this

It's worth a quick check with Avail/your CAD admin console: does Avail already tag routes internally with a service type (something used to separate fixed-route from charter/event work order in their own system, even if it's not exposed in these particular API responses)? If so, it may be exportable or queryable directly, which would let `RouteClassification` be populated automatically instead of manually — worth 10 minutes of checking before committing to a fully manual table.

---

# Live Vehicle Tracking Feed Evaluation (AVL Reports) — Event Bus Monitoring

**Purpose:** Monitoring special event buses specifically, for the Event Module. Fixed-route vehicles are already tracked via the existing CAD system, so this pipeline doesn't need to power a fixed-route view at all; its whole job is surfacing live position for event service.

This is a **single-purpose ingestion path that filters to event buses only and discards the rest.**

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

**This is a fundamentally different feed shape than OTP and Missed Trips.** Those are batch/aggregate feeds meant for monthly compliance rollups. AVL Reports is raw, high-frequency vehicle telemetry — it has no `StopID` and no performance metrics at all. Its job is live position, not compliance scoring.

**Critical constraint: 24-hour maximum window per call.** You cannot pull a month at a time here. This feed is built for short, frequent polling, not periodic batch ingestion.

## Recommended approach: event-bus-only real-time ingestion path

This doesn't touch the monthly compliance pipeline at all — it's a standalone, real-time path dedicated to the Event Module:

- **Trigger:** Timer-triggered Azure Function on a short interval (e.g., every 1–2 minutes, matched to however often Avail actually refreshes AVL data), pulling a rolling window (e.g., "now minus 5 minutes" to "now") rather than the full 24-hour max.
- **Filter on ingest:** join each incoming ping's `Route` against `RouteClassification` (the same table from above) and **keep only `SpecialEvent` matches** — fixed-route pings are discarded at this stage rather than stored, since CAD already owns that view and there's no reason to duplicate it here.
- **Storage:** Two tables, scoped to event vehicles only —
  - `dbo.EventVehicleCurrentPosition` — upsert keyed on `Vehicle`, latest ping only, powers the Event Module's live map.
  - `dbo.EventVehiclePositionHistory` — append-only, if you want playback/trail for a given event after the fact (useful for post-event review or a rider complaint about a specific shuttle).
- **No Service Bus fork needed** for this feed specifically — since fixed-route pings never get published in the first place, there's nothing to route between topics. If the Event Module itself needs to notify other parts of the app of position updates, a single `event-vehicle-positions` topic is enough.

## Classification note

`Route` here has the same problem as `RouteID` elsewhere — just a number, no service-type flag — so this pipeline depends on the same `RouteClassification` table staying current. Since this feed is now the **primary consumer that cares about that table in real time**, it raises the stakes on keeping it accurate: a RouteID added to `RouteClassification` late (after an event has already started running) means that event's buses won't show up in the Event Module until the table is updated. Worth deciding whether route setup for an event includes registering it in `RouteClassification` as a required step in the event-prep checklist, not an afterthought.

`Vehicle` (bus number) is available directly on this feed and could serve as a fallback/secondary classifier — useful if event buses ever run under a RouteID that's ambiguous or shared with regular service on the same day.

---

## AVL Reports 404 — Root Cause (from live-data investigation, 2026-08-05)

`availAvl.ts` builds its request as `${baseUrl}/${formatDateYyyyMmDd(date)}` — a single date-only segment. The real shape documented above is **`GET /{Property}/{Start DateTime}/{End DateTime}`** — three path segments (Property + two full datetimes, format `YYYY-MM-DD HH:MI:SS`, not just a date), 24-hour max window. The production code is missing the `{Property}` segment entirely, missing the second datetime segment, and using date-only formatting instead of full datetime. Any one of those would 404 against Azure API Management's route matching; all three compound it. **This section's spec is the one to rebuild the request against.**

Pullout Reports (Garage Pull Out / Fixed Route Departures) fails identically but its actual spec has not been provided to this evaluation — needs the real OpenAPI doc before a fix is written, not a guess extrapolated from AVL's shape.

---

## Open Questions Before Implementation

1. **(Missed Trips feed)** Should `Full Trip Only` be `1` (strict) or `0` (either end missed) per Attachment G's definition of a missed trip? Confirm against contract language.
2. **(Missed Trips feed — on-demand)** No on-demand/paratransit missed-trip feed was provided in this round. If Avail exposes an equivalent endpoint for demand-response service, it should be evaluated separately — fixed-route and on-demand compliance likely need distinct scoring logic and possibly distinct storage tables.
3. **(Route classification)** Does Avail/the CAD system already tag RouteIDs by service type internally (even if not exposed in these API responses)? If yes, `RouteClassification` could be populated automatically instead of manually maintained. Also confirm whether event RouteIDs are ever reused across different events over time (which would require the `EffectiveStartDate`/`EffectiveEndDate` columns to disambiguate) or whether each event gets a unique, permanent RouteID.
4. **(AVL Reports)** What's Avail's actual AVL refresh cadence? That determines the right polling interval for the Timer Function — polling faster than the source data updates just wastes calls. Also confirm the process for registering a new event's RouteID(s) in `RouteClassification` *before* the event starts running, so its buses aren't missing from the Event Module on event day. And confirm whether Route-based filtering alone is reliable, or a Vehicle-based fallback is needed for cases where event buses share a RouteID with regular service.
5. **(Pullout / Garage Pull Out)** Real API spec still needed — same missing-segment root cause is the leading hypothesis but unconfirmed. Get the OpenAPI doc or one confirmed working raw call before writing a fix.
