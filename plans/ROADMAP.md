# Roadmap

> The consolidated roadmap is maintained in `MVTA_ONBOARD_MANUAL.md`. This
> file retains additional detail about speed-signal accuracy.

Future work under consideration, not yet scheduled or built. See `CHANGELOG.md` for what's already shipped and `HANDOFF.md` for the original project background.

## Speed Alerts accuracy improvements

Prompted by a real question: how can a control center specialist actually be sure a flagged vehicle is speeding, rather than looking at a GPS blip or a perfectly normal highway speed? Today's `Speed Alerts` module ([SpeedAlerts.tsx](frontend/packages/onboard-console/src/routes/modules/SpeedAlerts.tsx)) flags a flat 50 mph fleet-wide threshold with no location or road-type context, and no persistence check - a single noisy reading is enough to show up. Three improvements, roughly cheapest to most involved:

1. **Capture `congestion_level` from the GTFS-RT VehiclePosition feed.** The raw feed already includes this field (RUNNING_SMOOTHLY / STOP_AND_GO / CONGESTION / SEVERE_CONGESTION) - [gtfsVehiclePositions.ts](functions-restapi/src/lib/gtfsVehiclePositions.ts) defines it on the type but never extracts or stores it. A fast reading paired with "running smoothly" is a much more trustworthy signal than a fast reading with no congestion context at all. No new external dependency - just wire up a field already arriving in the feed.

2. **Cross-check reported speed against position deltas.** `MonitoredTripDelays` already stores lat/lon on every poll; distance between two consecutive fixes ÷ time elapsed gives an independent speed estimate to compare against the AVL's own reported `Speed` value. A big disagreement between the two is a strong signal the reading is bad telemetry (GPS glitch) rather than an actually-fast bus. Also uses only data already collected.

3. **Integrate MnDOT traffic data (511 / RTMC) for a real road-speed baseline.** MnDOT's Regional Transportation Management Center publishes real-time freeway loop-detector data (speed, volume) for the Twin Cities metro, and 511mn.org has incident/closure data. This would give an actual "expected speed on this road segment right now" to compare against, instead of one flat threshold applied everywhere. Meaningfully bigger lift than the above two - a new external API with unknown access/auth requirements, needing the same kind of upfront investigation done for MVTA's own GTFS-RT feed before anything could be built against it.

## Other known future work (tracked elsewhere, listed here for visibility)

- **Phase 4: SpareLabs / MVTA Connect (On-Demand) feed integration** - `source='zona'` in `SuggestedAlerts` has no producer yet. See `HANDOFF.md` and `functions-restapi/sql/migration-003-suggested-alerts.sql`'s comments.
- **Confirmation + STOP/HELP subscriber endpoints** - blocked on Azure Communication Services provisioning.
- **Dispatch Log (trip-start verification)** - the SST OCS desk initials every revenue trip's start in a shared workbook, by hand, on a weekly rotation. OnBoard already holds the schedule side and a coarse actual-start signal; the spec in [dispatch-log-spec.md](dispatch-log-spec.md) proposes a nightly-materialized `TripStartLog`, a first-stop departure capture from GTFS-RT TripUpdate for the 5-minute rule, and a one-dataset, three-view console module under Service Operations. Open: who records verifications (§7.1) and whether the `Alternative` column survives (§7.3).
- **A real map view for Live Delays / Speed Alerts** - lat/lon is stored per vehicle but never rendered on an actual map; no mapping library exists in this codebase today. Would help both the speed-accuracy question above and general fleet visibility.
