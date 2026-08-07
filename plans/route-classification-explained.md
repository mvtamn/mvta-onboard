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

The main consumer is
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

Other Avail360 feeds have not been surveyed for special-service coverage beyond
OTP Monthly and Missed Trips (name fields only). If broader coverage would
help — e.g. a feed that exposes operator login / run assignment directly, which
would let special service be detected rather than hand-classified — that is
available to investigate.

## Known gap

The poller filters on `is_active` only and **ignores
`effective_start_date` / `effective_end_date` entirely**. A reused event RouteID
whose window has expired will keep streaming into the event tables until someone
flips `is_active` off manually. If date-windowing is meant to be enforced, that
is the fix.
