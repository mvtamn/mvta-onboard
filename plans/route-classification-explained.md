# Route Classification — how it works, and the feed-coverage caveat

## What it is

[`functions-restapi/src/functions/routeClassification.ts`](../functions-restapi/src/functions/routeClassification.ts)
is not a single "classify" algorithm — it is the CRUD API behind a
**human-maintained lookup table**. It exists because no Avail360 feed (OTP,
Missed Trips, AVL Reports) carries any fixed-route-vs-special-event flag
anywhere in its schema. Every feed hands back a bare numeric `RouteID`. So
MVTA OnBoard keeps its own decision in `RouteClassification`
([migration-016](../functions-restapi/sql/migration-016-route-classification.sql))
and every downstream consumer reads from that table rather than guessing from a
feed.

Schema (migration-016):

| Column | Notes |
| --- | --- |
| `route_id` | INT, PK — Avail's own bare RouteID |
| `route_category` | `FixedRoute` \| `SpecialEvent` \| `OnDemand`, enforced by CHECK constraint |
| `route_label` | Friendly name, e.g. "Vikings Game Shuttle" |
| `effective_start_date` / `effective_end_date` | `CHAR(8)` YYYYMMDD, for a reused event RouteID |
| `is_active` | BIT, default 1 |
| `updated_by` / `updated_at` | Audit |

An unmatched RouteID is treated as *unclassified* by consumers (LEFT JOIN +
COALESCE), not silently assumed to be fixed-route.

## The three endpoints

### `GET /route-classification` ([:63](../functions-restapi/src/functions/routeClassification.ts#L63))

Any staff read role, plus `OCC.Compliance`. Returns two things:

- **`routes`** — every classification row, with dates converted `YYYYMMDD` →
  `YYYY-MM-DD` on the way out.
- **`unclassified`** — the discovery list. Takes `DISTINCT route` from
  `AvailAvlVehiclePositions`, subtracts anything already in
  `RouteClassification`, and for each leftover tries to find a human-readable
  name via correlated `TOP 1` subqueries against
  `OtpMonthlyRouteStopDay.route_label`, then
  `AvailMissedTripsRouteStopDay.route_internet_name`, then `.route_desc`
  ([:96-112](../functions-restapi/src/functions/routeClassification.ts#L96)).
  Those are the only two feeds carrying a route name at all. If none hit,
  `suggested_label` is `null` and the admin sees a bare RouteID — deliberately
  honest rather than a guess. The whole block sits behind an `OBJECT_ID`
  table-exists guard because those tables come from separate migrations.

This closes a real gap: the Admin page's route picker is fixed-route-only
(sourced from `GtfsRoutes`), so it never surfaces special-event / non-revenue
IDs like Avail's own `Special1111` / "Rescue Bus" naming convention.

### `PUT /route-classification/{routeId}` ([:123](../functions-restapi/src/functions/routeClassification.ts#L123))

Publisher/Admin. Validates via `validateRouteClassification`
([validation.ts:402](../functions-restapi/src/lib/validation.ts#L402)), then a
`MERGE … WITH (HOLDLOCK)` upsert with `OUTPUT INSERTED.*`, so the response is
the persisted row rather than the request echoed back. `updated_by` comes from
the auth principal.

### `DELETE /route-classification/{routeId}` ([:200](../functions-restapi/src/functions/routeClassification.ts#L200))

Publisher/Admin, **hard delete** — deliberately breaking the
soft-delete/deactivate convention used by Detours and OtpReasonCodes. The table
is pure current-state (a RouteID either *is* or *isn't* special-event right
now), and nothing references a row for audit/compliance history the way
`OtpStopExclusions` rows do, so there is nothing a hard delete would corrupt.
Added 2026-08-06 after a real fixed route was classified as `SpecialEvent` for
testing with no way to undo it.

## Who consumes it

### Event Monitoring is the primary consumer

Route Classification is what makes Event Monitoring possible at all, and it
supplies **route identity in addition to lat/long**. The full chain:

```
AVL Reports (operator logged into a special route)
  → availAvlPoll.ts, filtered by RouteClassification.route_category='SpecialEvent'
  → EventVehicleCurrentPosition / EventVehiclePositionHistory
  → GET /event-vehicle-positions
  → Event Monitoring map + table
```

Special routes surface **from AVL Reports** — that is the only feed where a
vehicle logged into special service appears — and Route Classification is what
turns a bare RouteID from that feed into something nameable and filterable.
Position alone is not enough: an event map showing unlabeled dots cannot tell an
operator which shuttle is which.

Concretely, `GET /event-vehicle-positions` `LEFT JOIN`s `RouteClassification`
and returns `route_label` / `route_category` alongside
`latitude`/`longitude`/`heading`, and the console's `eventRouteLabel()` resolves
**classification first, GTFS second**. The prior order was wrong for exactly the
reason documented in the caveat below — it resolved names from
`getRoutes()`/`GtfsRoutes`, which by definition cannot contain a special-event
RouteID, so every event bus rendered as a bare "Route 1111" even when an admin
had typed "Vikings Game Shuttle" into the classification row. GTFS remains the
fallback only for a *fixed* route temporarily classified `SpecialEvent`, where
`route_label` may be blank.

The other consumer is
[`availAvlPoll.ts:48-57`](../functions-restapi/src/functions/availAvlPoll.ts#L48).
On each 5-minute AVL Reports poll it loads `route_id` where
`route_category = 'SpecialEvent' AND is_active = 1` into a `Set`, and for
reports whose route is in that set writes an *additional* row into
`EventVehicleCurrentPosition` / `EventVehiclePositionHistory` — reusing the
existing fetch rather than adding a second poll against the same feed. It is
guarded so an un-migrated DB simply skips the event write without failing the
main all-vehicles upsert.

## Feed-coverage caveat: GTFS Static / GTFS-RT will not see special service

**Important.** If a consumer is built on GTFS Static and GTFS-RT, special
service routes **will not be observed in those feeds at all.** Special service
is not published in the GTFS static schedule, and it therefore has no
corresponding trip/route in GTFS-RT either. Anything that discovers or monitors
routes by way of GTFS will be structurally blind to event and other special
service.

**AVL Reports is the feed that does see it.** Specific vehicles have operators
logged into special service routes, and those logins surface in AVL Reports as
the bare `RouteID`. That is precisely why the discovery list in
`GET /route-classification` is driven off `AvailAvlVehiclePositions` (populated
from AVL Reports) rather than off `GtfsRoutes` — AVL Reports is the only
real-time source where a special-service RouteID appears at all.

Practical implications:

- Do **not** treat "absent from GTFS" as "not a real route." For special
  service it is the expected state.
- Special-service route naming is not resolvable from GTFS. Labels come only
  from OTP Monthly / Missed Trips (when that route happened to generate
  schedule-adherence data), otherwise a human supplies `route_label`.
- Event monitoring must stay AVL-driven end to end. Adding a GTFS-RT path for
  event vehicles would silently return nothing.

## AVL Reports first — what it actually carries

Checked before reaching for any other feed. Per `AvailAvlReport` in
[`availAvl.ts`](../functions-restapi/src/lib/availAvl.ts), each report is:

| Field | Stored as | Useful for classification? |
| --- | --- | --- |
| `Vehicle` | `vehicle_id` (PK) | Yes — identifies the bus logged into the route |
| `Route` | `route` | Yes — the bare RouteID being classified |
| `Block` | `block` | Signal — see below |
| `Run` | `run` | Signal — the operator's run assignment |
| `Trip` | `trip` | Signal — see below |
| `Direction` | `direction` | No (`'O'` / `'I'` code only) |
| `Timestamp`, `Latitude`, `Longitude`, `Heading` | as named | No |

Two conclusions:

**1. AVL Reports has no name field at all.** There is nothing to prefer over
OTP Monthly / Missed Trips for `suggested_label` — the existing fallback chain
is already the best available, and for a brand-new event RouteID with no
schedule-adherence history the label genuinely has to be typed by a human.

**2. AVL Reports *can* auto-detect special service, without needing a name.**
The operator login is the signal, and it already lands in
`AvailAvlVehiclePositions` on every 5-minute poll. Two usable heuristics, both
answerable from data already in the DB:

- **Not in the static schedule.** A `route` present in
  `AvailAvlVehiclePositions` with no matching row in `GtfsRoutes` is, by
  definition, a RouteID no GTFS consumer can see — a strong special-service /
  non-revenue candidate. This turns the GTFS blind spot above into the
  detection mechanism rather than a limitation. Note `GtfsRoutes.route_id` is
  `NVARCHAR(50)` while `AvailAvlVehiclePositions.route` is `INT`, so the join
  needs an explicit cast.
- **Logged in with no scheduled work.** `trip IS NULL` (and often
  `block IS NULL`) on a vehicle that is otherwise reporting position means an
  operator is logged into a route with no scheduled trip behind it — the normal
  shape for event and rescue service.

Neither is proof, so the right use is to **pre-fill the category in the Admin
editor as a suggestion** — surface `unclassified` routes already marked
"likely SpecialEvent (not in GTFS)" — while keeping the human confirmation step.
That is a strict improvement on today's bare-RouteID-with-no-hint list, and it
needs no new feed integration: only a `LEFT JOIN GtfsRoutes` added to the
existing discovery query in
`GET /route-classification` ([:96](../functions-restapi/src/functions/routeClassification.ts#L96)).

**Caveat on relying on it.** AVL Reports is the newest and least stable of the
integrations — three separate root causes for returning nothing, all now fixed:

1. 1800+ consecutive 404s from deployment through 2026-08-05 — wrong URL shape
   (one date-only segment instead of Property + two datetime segments).
2. 14 days of `success=true` with an always-empty array — `encodeURIComponent`
   escaped the colons to `%3A`, which Avail silently no-ops on. Fixed
   2026-08-06.
3. `0 reports seen` on every poll through 2026-08-07 — **the window was built
   in UTC, but Avail interprets these datetime segments in agency-local time**,
   so every poll requested a window five hours in the future. Proven from
   Avail's own response: a request for `[2026-08-07 20:45:00 -> 20:55:00]` came
   back with `RefreshTime: 2026-08-07T15:55:00`, its own "now", exactly UTC-5
   behind. An out-of-range window returns an empty array with `success: true`,
   not an error, which is why this survived two prior fixes. Now formatted in
   `America/Chicago`, so CDT/CST is handled without a hardcoded offset.

The pattern across all three: this feed reports *nothing* rather than
complaining. An AVL-first design must therefore treat an empty or sparse poll as
"unknown", never as "no special service running."

**Second limitation on discovery specifically.** `AvailAvlVehiclePositions` is
latest-only — `availAvlPoll.ts` MERGEs on `vehicle_id`, keeping one row per
vehicle. A special-service RouteID therefore disappears from the discovery list
as soon as that vehicle's next report shows a different route, so the
`unclassified` list reflects *what is running right now*, not what ran today.
An event that finished this morning leaves no trace to classify by afternoon.
`EventVehiclePositionHistory` is append-only but is written only for routes
*already* classified `SpecialEvent`, so it cannot close this gap — that is a
chicken-and-egg. Classifying while service is actually running is the current
workaround.

Only if that proves insufficient is it worth surveying other Avail360 feeds —
e.g. one exposing operator login / run assignment more directly than the
`Run` / `Block` / `Trip` values above.

## Known gap

The poller filters on `is_active` only and **ignores
`effective_start_date` / `effective_end_date` entirely**. A reused event RouteID
whose window has expired will keep streaming into the event tables until someone
flips `is_active` off manually. If date-windowing is meant to be enforced, that
is the fix.
