# OTP Data Feed Evaluation & Recommendation

**Purpose:** Select the Avail OTP data feed for continuous ingestion into MVTA OnBoard (Azure-hosted) to support monthly OTP compliance checks with stop-level filtering.

**Requirements driving the decision:**
1. Continuous / recurring ingestion (not a one-off manual export)
2. Monthly compliance evaluation cadence
3. Ability to filter/report by specific stops
4. Ingested and stored via Azure (Function App + SQL)

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

## Open Questions Before Implementation

1. **(OTP feed)** Do Early Outlier / Late Outlier thresholds need to be configurable per compliance cycle (e.g., stored as app config, adjustable by an admin), or can they be hardcoded constants in the Function?
2. **(Missed Trips feed)** Should `Full Trip Only` be `1` (strict) or `0` (either end missed) per Attachment G's definition of a missed trip? Confirm against contract language.
3. **(Missed Trips feed — on-demand)** No on-demand/paratransit missed-trip feed was provided in this round. If Avail exposes an equivalent endpoint for demand-response service, it should be evaluated separately — fixed-route and on-demand compliance likely need distinct scoring logic and possibly distinct storage tables.
