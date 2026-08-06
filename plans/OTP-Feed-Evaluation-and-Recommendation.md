# OTP Data Feed Evaluation & Recommendation

**Purpose:** Select the Avail OTP data feed for continuous ingestion into MVTA OnBoard (Azure-hosted) to support monthly OTP compliance checks with stop-level filtering.

**Requirements driving the decision:**
1. Continuous / recurring ingestion (not a one-off manual export)
2. Monthly compliance evaluation cadence
3. Ability to filter/report by specific stops
4. Ingested and stored via Azure (Function App + SQL)

---

## Configuration Values

| Parameter | Value | Applies to |
|---|---|---|
| `{Property}` | `MVTA` | All Avail feeds referenced in this document (OTP, Missed Trips, AVL Reports) — replaces the `ACME` placeholder used in the API spec examples |

**Worth verifying, not just assuming:** `MVTA` is the value being used, but it hasn't been confirmed character-for-character against what Avail actually has on file for this account. The API spec documents `{Property}` as a plain string in some feeds and an enum in others (e.g., OTP Monthly's spec shows `"enum": ["ACME"]` for its sample account) — if MVTA's actual registered property code has different casing, an abbreviation, a numeric suffix, or is something other than the literal string `MVTA`, that could produce exactly the symptom seen in production: a **structurally valid, `success: true` response with zero rows**, because the request is well-formed but simply doesn't match any property Avail has data under. This is a stronger candidate for the empty-Monthly-feed mystery than backend aggregation lag, since a wrong Property value would still pass a valid-looking request through cleanly rather than erroring — see the diagnostic section below, which now leads with this check specifically.

---

---

## Endpoint Reference (Exact Path Shapes, Pulled Directly from Avail's OpenAPI Specs)

Given AVL Reports 404'd for months because of a missing path segment, this table exists so every request can be visually diffed against the actual spec rather than reconstructed from memory. All four OTP feeds use `{Property}` as the first segment; production host is `avail360-api.myavail.cloud`, test/sandbox host is `avail360-test.myavail.cloud`.

### 1. OTP By Route/Day/Hour — `otp-by-route-day-hour`

```
GET https://avail360-api.myavail.cloud/OtpByRouteDayHour/v1/{Property}/{Start Date}/{End Date}/{Early Threshold}/{Late Threshold}/{Early Outlier}/{Late Outlier}/{Show Missed Stops}/{Include Outliers}/{Show Detours}
```
Ruled out (no StopID) — included here only for completeness/reference.

### 2. OTP By Route/Stop/Hour — `otp-by-route-stop-with-custom-thresholds-and-excluded-outliers`

**Correction:** this feed's actual title is "Avail OTP By Route/Stop/**Hour**" but its base path is `OtpByRouteStop` (not `OtpByRouteStopHour` as shorthanded earlier in this doc), and it has **three valid path shapes** depending on how many optional trailing segments are supplied — not one fixed shape like the other OTP feeds:

```
GET https://avail360-api.myavail.cloud/OtpByRouteStop/v1/{Property}/{Service Date}
GET https://avail360-api.myavail.cloud/OtpByRouteStop/v1/{Property}/{Service Date}/{Early Threshold}/{Late Threshold}
GET https://avail360-api.myavail.cloud/OtpByRouteStop/v1/{Property}/{Service Date}/{Early Threshold}/{Late Threshold}/{Early Outlier Threshold}/{Late Outlier Threshold}
```

**Field names also differ from the other OTP feeds** — worth flagging since it's easy to assume all four OTP feeds share one response shape:
- `StopName` (not `StopInternetName`)
- `PctEarly`, `PctOnTime`, `PctLate`, `PctNotOnTime` (not `PercentEarly`, `PercentOntime`, etc.)
- `OnTime` (capital T, not `Ontime`)
- **No `Missed`, `ActualDepartures`, or outlier-count fields at all** — this feed doesn't track missed stops, unlike the other three OTP feeds.
- Top-level envelope uses `ServiceDate`, `MaxEarlyExclusion`, `MaxLateExclusion` (not `StartDate`/`EndDate`/`EarlyOutlier`/`LateOutlier`).

This feed remains scoped as viable-but-not-primary in this doc (loses the DayOfWeek breakdown), but if it's ever wired up, the field-name mismatch above needs its own mapping — don't reuse the parsing logic built for the other three OTP feeds.

### 3. OTP By Route/Stop/Day/Hour — `otp-by-route-stop-day-hour`

```
GET https://avail360-api.myavail.cloud/OtpByRouteStopDayHour/v1/{Property}/{Start Date}/{End Date}/{Early Threshold}/{Late Threshold}/{Early Outlier}/{Late Outlier}/{Show Missed Stops}/{Include Outliers}/{Show Detours}
```
This is the feed promoted to daily/near-real-time polling above.

### 4. OTP Monthly By Route/Stop/Day of Week — `otp-by-month-route-stop-day-of-week`

```
GET https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1/{Property}/{Service Date}/{Early Threshold}/{Late Threshold}/{Early Outlier}/{Late Outlier}/{Show Missed Stops}/{Include Outliers}/{Show Detours}
```
Note: `{Service Date}` format is `MM-DD-YYYY` here, whereas feeds #1 and #3 use `{Start Date}`/`{End Date}` in `YYYY-MM-DD` format. Different date format between feeds is itself a place a copy-pasted request builder could silently break — worth a shared, explicitly-named date formatter per feed rather than one generic date formatter reused everywhere.

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

## Implementation Status Update (2026-08-05) — Live Data Investigation Findings

Ty's team ran a real production investigation (`otp-compliance-live-data-rethink.md`) after the OTP Compliance module's live data appeared broken. Cross-referencing that against this doc:

### AVL Reports 404 — root cause confirmed, matches this doc's original flag

`availAvl.ts` builds its request as `${baseUrl}/${formatDateYyyyMmDd(date)}` — a single date-only segment. This doc's AVL Reports section (above) documented the real shape as **`GET /{Property}/{Start DateTime}/{End DateTime}`** — three path segments (Property + two full datetimes, format `YYYY-MM-DD HH:MI:SS`, not just a date), 24-hour max window. The production code is missing the `{Property}` segment entirely, missing the second datetime segment, and using date-only formatting instead of full datetime. Any one of those would 404 against Azure API Management's route matching; all three compound it. **Confirms this doc's spec is the one to rebuild the request against.** Pullout Reports fails identically but its actual spec hasn't been provided to this evaluation yet — needs the real OpenAPI doc before a fix is written, not a guess extrapolated from AVL's shape.

### OTP Monthly / Missed Trips returning genuinely empty — consistent with a known gap in the original design

This doc's original ingestion pattern (see "Suggested Azure Ingestion Pattern" above) was **month-close-out, pull the prior complete month, once**. That was changed during implementation to hourly polling of the *current, in-progress* month — which this doc did not originally account for, and which turns out to matter: `OtpByRouteStopDayAgg` and the Missed Trips feeds have no guaranteed real-time freshness guarantee from Avail's side, and a poller that only ever asks about "whatever month is current right now" has no mechanism to notice a month that was empty on day 1 but populated by day 5. **Recommend building the trailing-window backfill job proposed in the investigation doc** (re-fetch current month + prior 2, daily) rather than relying on the hourly current-month-only poll to ever self-correct.

### New requirement: OTP measurement more frequent than monthly

This is the one gap in the original recommendation. `OtpByRouteStopDayAgg` is **structurally incapable** of sub-month granularity — it's a month-level aggregate by design; passing a different date within the same month returns identical rows (confirmed independently by both this doc and the investigation doc). No amount of polling frequency changes that — hourly polling of a monthly aggregate adds request load without adding resolution, since the underlying numbers can't move within the month.

**To get real sub-monthly OTP measurement, promote `OtpByRouteStopDayHour` from "secondary/drill-down" (as originally scoped above) to a first-class, regularly-polled feed:**

- It carries a genuine `CalendarDate` per record with a custom Start/End Date range — the only OTP feed reviewed that can answer "what was OTP for this stop yesterday / this week" rather than "what was OTP for this stop this month."
- **Recommended cadence:** daily Timer-triggered Function, pulling the prior day's date range (`Start Date` = `End Date` = yesterday), stored keyed on `(RouteID, StopID, CalendarDate, HourOfDay)`. This gives the app enough raw data to compute its own rolling views (trailing 7-day OTP by stop, week-over-week trend) without waiting on Avail's monthly aggregation cycle at all.
- **`OtpByRouteStopDayAgg` stays in place as the authoritative monthly number for Attachment G compliance scoring** — that's a contractual/official figure and shouldn't be replaced by an app-side rollup of the daily feed, even though the daily feed could technically approximate it. Keep both: monthly feed for the official compliance record, daily feed for trending and early-warning visibility between month-end close-outs.
- This also directly serves the earlier stop-filtering requirement, since `OtpByRouteStopDayHour` carries `StopID` the same as the monthly feed does.

**Net effect on ingestion architecture:** three OTP-related jobs instead of one — (1) the existing monthly-feed poll, now paired with a daily trailing-backfill to catch Avail-side aggregation lag; (2) a new daily pull of `OtpByRouteStopDayHour` for sub-monthly trending; (3) drop the hourly-on-current-month cadence for the monthly feed itself, since it was polling a value that structurally cannot change hour-to-hour.

---

## OTP Module UI Requirement: Near Real-Time by Route + Cumulative

Ty's requirement: the OTP module should show **near real-time OTP by route**, and a **cumulative** figure — a single system-wide total across all routes, distinct from the per-route breakdown in View 1 — not truly live (no need to compute OTP from raw AVL pings against schedule), but current enough that it isn't waiting on Avail's monthly aggregation cycle. This means two distinct views, both sourced from `OtpByRouteStopDayHour`, not from the Monthly feed:

### View 1 — Near real-time, by route

- `OtpByRouteStopDayHour` returns stop-level rows; the "by route" view requires an **app-side rollup that sums across all stops for a given `RouteID`** within the selected window (e.g., today, or a trailing 24–48 hours) rather than presenting stop-level rows directly.
- **Revise the polling cadence from once-daily to every 2–4 hours during service hours.** A single overnight pull, as scoped earlier for "sub-monthly trending," is enough for day-over-day trend views but not for something described as near real-time within a single service day. This is still bounded by however long Avail's own backend takes to process a completed trip into a queryable OTP row — that processing lag hasn't been measured for this feed (see the caveat two turns back) and should be checked with a direct test-fetch before committing to a specific polling interval, the same way the Monthly feed's emptiness was diagnosed rather than assumed.

### View 2 — Cumulative (system-wide, all routes combined)

**Cumulative means one aggregate OTP figure across every route, not a per-route running total.** Where View 1 rolls raw rows up to `RouteID`, View 2 rolls the same raw rows up across **every** `RouteID` and `StopID` for the period — collapsing the whole system down to a single percentage. Both views read from the same ingested `OtpByRouteStopDayHour` data; they differ only in the `GROUP BY` — View 1 groups by `RouteID`, View 2 has no route grouping at all.

This should be **computed by the app from the same `OtpByRouteStopDayHour` data already being ingested for View 1** — a running month-to-date rollup — rather than waiting on `OtpByRouteStopDayAgg` (the Monthly feed), for two reasons:

1. The Monthly feed only finalizes once a month closes (and per the live-data investigation, may lag even after that) — it cannot show a cumulative-so-far number mid-month by design.
2. The Monthly feed is currently returning zero rows in production for reasons still under investigation. Until that's resolved, an app-computed cumulative rollup from `OtpByRouteStopDayHour` is the only OTP data source that's actually working end-to-end — this raises its priority, not just its usefulness.

**Aggregation detail worth getting right in the implementation:** compute the cumulative percentage by **summing the raw counts** (`Early`, `Ontime`, `Late`, `Missed`, `ActualDepartures`, `Total`) across all routes, stops, days, and hours in the month-to-date window, then deriving the single system-wide percentage from those sums — *not* by averaging each day's or each route's `PercentOntime` value. Averaging would weight a low-ridership route or day the same as a high-ridership one, which will skew the cumulative number.

**Reconciliation:** once `OtpByRouteStopDayAgg` starts returning real data for a closed month (pending the root-cause fix), sum it across all routes and compare against the app's own system-wide cumulative rollup for that same month as a data-integrity check. A meaningful mismatch would indicate either a gap in the daily `OtpByRouteStopDayHour` pulls or a difference in how Avail itself aggregates the monthly figure — worth surfacing as a QA step rather than silently trusting one over the other. The Monthly feed still stays the official Attachment G number once it's confirmed working; the app-computed cumulative is a near-real-time stand-in, not a permanent replacement.


---

## Diagnostic: Is the Monthly Feed's Empty Response Real or a Bug?

Both July (fully closed) and August (in-progress) returning `success: true` with zero rows is ambiguous by itself — it's consistent with (a) Avail genuinely has no OTP data configured for MVTA's account on this feed, (b) something in the request is subtly wrong in a way that doesn't trigger an error, just an empty result set, or **(c) the `{Property}` value itself doesn't match what Avail has on file** — a well-formed request against the wrong property string would produce exactly this "valid envelope, zero rows" pattern rather than an error, which makes it a strong candidate given the symptom. This is testable directly, bypassing the app entirely.

**I can't run this test myself** — `avail360-test.myavail.cloud` / `avail360-api.myavail.cloud` aren't reachable from this environment's network allowlist. These are steps for Ty (or whoever holds the Avail subscription key) to run directly.

### Step 0 — Confirm the exact `{Property}` string with Avail first

Before testing anything else, verify `MVTA` is the literal, character-for-character value Avail has registered for this account — check Avail's own admin/reporting portal (same login as Step 2 below) for how the property is actually named there, or ask Avail support directly. Things worth specifically ruling out:
- **Casing** — some APIs are case-sensitive on path parameters even when documentation doesn't call that out.
- **A different code entirely** — the sample spec shows `"enum": ["ACME"]` for its example account; MVTA's real registered value could be an abbreviation, a numeric ID, or something that isn't simply the property's common name.
- **Whitespace or hidden characters** — if `MVTA` was ever copy-pasted from a source with invisible formatting, it's worth retyping it fresh rather than assuming the stored config value is clean.

If Step 0 turns up a different value than what's currently configured in the app, **fix that first and re-test before doing anything else below** — it would explain the empty response for both OTP Monthly and Missed Trips in one shot, without needing a backfill job or any code change to the request-building logic itself.

### Step 1 — Direct call against a definitely-closed, older month

Bypass the app's database and Function entirely; call Avail directly for a month several months back — not just July, which is close enough to "recent" that a backend-processing-lag explanation is still plausible:

```bash
curl -G "https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1/MVTA/03-15-2026/1/5/15/30/0/1/1" \
  -H "Ocp-Apim-Subscription-Key: <your subscription key>"
```

- Use `EarlyOutlier=15` / `LateOutlier=30` — the exact values shown in the API spec's own example — in case the app's configured outlier values are themselves part of the problem (unlikely, but cheap to rule out by matching the known-good example exactly).
- Repeat for 2–3 different months spread further back (e.g., January, March, May 2026) to build a pattern rather than relying on one data point.

**If any of these return real rows:** points to explanation 1 from the investigation doc (Avail's aggregation has a lag, and MVTA's recent months just haven't populated yet, or the app's poller design gap in never re-checking a month is the real issue) — not an Avail-side configuration problem.

**If all of these come back empty too:** points hard at explanation 2 (Avail has no OTP tracking populated for MVTA's account, full stop) — a configuration/provisioning question for Avail support, not a code fix.

### Step 2 — Check Avail's own reporting portal directly

Faster than Step 1 if portal access is available: log into Avail's own reporting UI for the MVTA property and look for OTP data on any date, for any month. If the portal itself shows no OTP numbers, that confirms explanation 2 without needing to touch the API at all. This was flagged as already pending from Ty in the investigation doc — worth prioritizing since it's the single fastest way to rule this in or out.

### Step 3 — Cross-check against Missed Trips for the same month

Missed Trips is returning the identical "clean run, zero rows" pattern as OTP Monthly. Run the same direct-call test against `MissedTripsByRouteStopDay` for the same historical months:

```bash
curl -G "https://avail360-api.myavail.cloud/MissedTripsByRouteStopDay/v1/MVTA/2026-03-01/2026-03-31/0/0" \
  -H "Ocp-Apim-Subscription-Key: <your subscription key>"
```

If Missed Trips also comes back empty for the same test months, that strengthens explanation 2 (account-level provisioning gap affecting multiple feeds) over a bug isolated to one endpoint. If Missed Trips returns data while OTP Monthly doesn't, that isolates the problem specifically to OTP tracking configuration on Avail's side.

### What this doesn't test

None of the above rules out a subtle request-shape bug that still resolves to a technically-valid-but-wrong URL (the same category of bug that caused Detours' silent wrong-key issue and AVL's 404s) — if Step 1 comes back empty across multiple months, it's still worth a side-by-side diff of the app's actual outgoing request URL (from Application Insights, the same tool that caught the Detours bug) against the curl command above, rather than assuming the direct test alone is conclusive.

---

## Open Questions Before Implementation

1. **(OTP feed)** Do Early Outlier / Late Outlier thresholds need to be configurable per compliance cycle (e.g., stored as app config, adjustable by an admin), or can they be hardcoded constants in the Function?
2. **(OTP near real-time)** How long after a trip completes does Avail's backend take to make it queryable via `OtpByRouteStopDayHour`? Test-fetch a known recent trip directly against Avail to measure this before finalizing the 2–4 hour polling interval proposed for the near-real-time-by-route view — same diagnostic approach as above rather than assuming.
3. **(Monthly feed empty data)** Run the direct-call diagnostic above (Steps 1–3) to determine whether the empty July/August response is an Avail-side provisioning gap or a subtle request bug, before building the backfill job — no point automating a backfill against a feed that may have nothing to backfill.

See `Missed-Trips-and-Supporting-Feeds-Evaluation.md` for Missed Trips, Fixed Route vs. Special Event routing, and AVL Reports (event bus monitoring) — split out to keep OTP-specific concerns separate.
