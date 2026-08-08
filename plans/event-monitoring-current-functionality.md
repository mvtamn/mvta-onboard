# Event Monitoring — Current Functionality

Last updated: August 8, 2026

## Purpose and access

Event Monitoring is a dedicated OCC.Admin workspace at `/console/event-monitoring`. It provides a live operational map and synchronized vehicle list for event service. It is intentionally a monitoring surface; it does not publish rider alerts or change vehicle assignments.

## Which vehicles are monitored

A vehicle appears only when all of the following are true:

1. Its route is classified as `SpecialEvent` in Admin > Route Classification.
2. The classification is active and its optional effective dates include today.
3. The vehicle has reported within the last three minutes.
4. Its coordinates fall within the configured MVTA operating-region bounds (latitude 43.0–46.0 and longitude -95.5–-92.0).

The Avail AVL poll runs every 30 seconds. Stale current-position rows are removed, while `EventVehiclePositionHistory` remains available for history and speed calculation.

## Live map

- Azure Maps road view is the default.
- Light, Night, and Satellite with labels styles are selectable.
- Traffic flow and incidents can be enabled.
- Bus markers show classified, filtered vehicles.
- Hovering or clicking a bus shows operator, vehicle, route, heading, speed, and report age.
- Clicking or panning the map never opens another window.
- **Open larger map** opens the current center and zoom in a separate Bing Maps window.
- The initial valid vehicle set is fitted once. Thirty-second refreshes update markers without resetting the operator's camera.
- The map can be minimized and restored.

## Filters

The map and table always use the same filtered vehicle set. Available filters are:

- Vehicle number, operator name, or route search
- Special-event route
- Heading: NB, SB, EB, or WB
- Moving or stopped

The active count reports the filtered count and total classified count. Clear filters resets the operational filters but leaves the selected map style and traffic layer unchanged.

## Vehicle details and data sources

| Field | Primary source | Fallback or behavior |
|---|---|---|
| Vehicle, route, coordinates, heading, report time | Avail AVL Reports | Required for a live marker |
| Friendly route name and monitoring eligibility | Route Classification | Only active `SpecialEvent` classifications are included |
| Block and run | Avail AVL Reports | Zero is normalized to unavailable |
| Operator | Avail Pullout Reports (`FixedRouteDepartures`) | Matches current/recent block+run or numeric vehicle label; source is returned as `Avail Pullout Reports` |
| Speed | GTFS-Realtime vehicle position | Falls back to distance/time between consecutive event-position reports |
| Cardinal heading | AVL heading/direction | Degrees are translated to NB, EB, SB, or WB |

## Known data limitations

- Avail AVL and GTFS-Realtime vehicle identifiers are not guaranteed to match.
- Special-event pullout assignments may not be present in the fixed-route Pullout Reports feed.
- Some AVL records provide route, block, or run as zero/null.
- Operator names remain `Operator unavailable` when neither block/run nor vehicle label produces a Pullout Reports assignment. The application does not infer or fabricate names.
- A future operator-assignment feed can be added as another server-side enrichment source without redesigning the map or table contract.

## Refresh and error behavior

- The browser requests updated event positions every 30 seconds and supports manual refresh.
- The latest successful UI refresh time is displayed.
- Feed, authentication, map-token, and API failures are shown as explicit status messages.
- When no vehicle matches current classifications, freshness, and geographic validation, the page states that no active vehicle matches the current SpecialEvent classifications.
