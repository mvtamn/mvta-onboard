# Feature Implementation Handoff

**Updated:** July 26, 2026  
**Audience:** Claude or another engineer continuing MVTA OnBoard

This document explains the implemented Fixed Route Service Risk and On-Demand
Service Quality work. Read `CURRENT_STATE.md` for the broader repository state
and `SUGGESTED_IMPROVEMENTS.md` for the longer-term product direction.

## Product rules

- Fixed-route service risk is based on **departures**, not arrivals.
- A fixed-route exception is significant when a future departure is predicted
  to be **more than 15 minutes late**.
- On-demand poor service means a predicted or actual customer wait of **more
  than 25 minutes**.
- Automated detections create reviewable operational exceptions or Suggested
  Alerts. They do not publish customer messages without staff approval.

## What was implemented

### Fixed-route departure prediction

`functions-restapi/src/lib/gtfsTripUpdates.ts` now:

- Sorts all future StopTimeUpdates by stop sequence.
- Prefers `Departure.Delay` and uses `Arrival.Delay` only as a fallback.
- Retains a departure prediction for every future stop with usable data.
- Calculates the maximum predicted future departure delay.
- Identifies the first stop predicted to cross the 15-minute threshold.
- Retains the absolute predicted departure time when supplied.
- Retains the GTFS service date.

`functions-restapi/src/functions/gtfsDelaysPoll.ts` now:

- Stores the prediction fields introduced by migration 008.
- Applies the two-poll persistence rule to the maximum future departure delay,
  not only the current next-stop delay.
- Creates departure-focused Suggested Alert wording.
- Uses a service-date-qualified external identifier so recurring scheduled trip
  IDs can create new suggestions on later service days.
- Stores a simple explainable confidence level and supporting reasons.

`GET /api/trip-delays` now returns the new prediction fields and orders
threshold-crossing trips first.

### On-demand wait-risk contract

Migration 009 creates `MonitoredOnDemandWaits`, a PII-free, vendor-neutral
current-state table.

`GET /api/on-demand-risks` returns active records ordered by:

1. Actual wait already over 25 minutes
2. Predicted wait over 25 minutes
3. Watch band over 20 minutes
4. Remaining monitored trips

The endpoint intentionally contains no vendor-specific parsing. A future
adapter should poll or receive the authoritative on-demand feed and UPSERT one
record per active trip into `MonitoredOnDemandWaits`.

### Staff console

OCC Tools now includes:

- **Fixed Route Risk**
- **On-Demand Quality**

Fixed Route Risk:

- Calls `GET /api/trip-delays`.
- Displays real future departure predictions when the API and migration are
  available.
- Shows the current delay, predicted maximum, first threshold departure,
  confidence, evidence, and stop-by-stop timeline.
- Preserves the previous Live Delays table under **Current telemetry**.
- Opens an existing Suggested Alert or creates one idempotent pending draft
  for review when **Prepare alert** is selected against live data.
- Shows a non-persistent customer-language preview when sample data is active.
- Supports local acknowledge and monitor states.

On-Demand Quality:

- Calls `GET /api/on-demand-risks`.
- Displays real wait-risk records after the producer is connected.
- Shows the 25-minute standard, current and predicted wait, vehicle assignment,
  stops ahead, accessibility context, confidence, and evidence.

Both screens fall back to clearly labeled preview scenarios when their
authenticated API is unavailable. Preview records must never be presented as
live operational data, and preview alert drafts are never saved.

### Alert preparation

`POST /api/suggested-alerts/prepare` creates or reuses a pending review item.
It uses `source + external_id` for deduplication and never publishes directly.
The console navigates to and highlights the prepared item in Suggested Alerts,
where authorized staff can approve and publish or dismiss it.

## Database deployment order

Run the existing migrations first, followed by:

1. `functions-restapi/sql/migration-008-departure-risk-predictions.sql`
2. `functions-restapi/sql/migration-009-on-demand-wait-risks.sql`

Deploy the REST API only after both migrations have completed. The updated
TripUpdate poller writes migration-008 columns on every processed entity.

## API additions

### Extended `GET /api/trip-delays`

Important new response properties:

```text
service_date
predicted_max_departure_delay_seconds
first_threshold_stop_id
first_threshold_stop_name
first_threshold_departure_at
departure_predictions[]
prediction_confidence
prediction_reasons[]
prediction_updated_at
```

Each `departure_predictions` entry contains:

```text
stop_sequence
stop_id
departure_delay_seconds
predicted_departure_at
```

### New `GET /api/on-demand-risks`

Important properties:

```text
request_id
external_request_id
zone_id
wait_started_at
predicted_pickup_at
current_wait_minutes
predicted_wait_minutes
assigned_vehicle_id
stops_ahead
accessible_vehicle_required
eligible_vehicles_in_zone
nearest_vehicle_context
trend
prediction_confidence
prediction_reasons[]
source_updated_at
last_polled_at
suggested_alert_id
```

## On-demand producer contract

Do not guess the vendor payload. Obtain:

- Authentication method
- Feed or webhook documentation
- Representative payloads
- Authoritative wait-start definition
- Pickup-window semantics
- Vehicle assignment fields
- Manifest/stop ordering
- Accessibility and capacity fields
- Cancellation and no-show states
- Source timestamps

Then create a separate adapter that normalizes vendor records into
`MonitoredOnDemandWaits`.

The adapter should:

1. Exclude customer names, phone numbers, addresses, and other PII.
2. Calculate current wait from the approved wait-start event.
3. Retain the source's predicted pickup when credible.
4. Calculate predicted total wait.
5. Set worsening/stable/recovering using recent observations.
6. Set confidence and plain-language reasons.
7. Update `last_polled_at`.
8. Remove or allow cleanup of completed/stale trips.
9. Create a Suggested Alert only after the configured persistence rule.

## Important limitations

- The fixed-route implementation uses future delays supplied by the current
  GTFS-Realtime TripUpdate feed. It does not yet import `stop_times.txt` or
  create independent historical travel-time predictions.
- A prediction timestamp is unavailable when the feed provides delay without
  an absolute `Time`.
- The fixed-route UI derives scheduled time by subtracting departure delay
  from the supplied predicted time. A later static schedule integration should
  become the authoritative scheduled-time source.
- Prediction trend is currently inferred in the UI from current versus maximum
  future delay. A historical observation table should replace that
  approximation.
- Downstream block prediction still requires static `block_id` and recovery
  time.
- The on-demand screen cannot show live data until the vendor adapter populates
  migration 009's table.
- Acknowledge and monitor state is currently local UI state. Alert preparation
  is persisted through Suggested Alerts, but a broader Operational Event model
  is still needed.

## Recommended next work

1. Apply migrations 008 and 009 in a controlled environment.
2. Deploy the REST API and confirm TripUpdate records populate the new fields.
3. Verify `Departure.Delay` and future StopTimeUpdates against live feed
   samples.
4. Connect the on-demand vendor adapter using approved payload documentation.
5. Add an append-only prediction observation table.
6. Import `stop_times.txt`, service calendars, shapes, and block IDs.
7. Persist acknowledge/monitor/prepare-alert actions in an Operational Event
   model.
8. Add integration tests using a test SQL database.
9. Add live smoke tests for both authenticated endpoints and alert
   preparation.

## Validation

The intended validation commands are:

```bash
cd functions-restapi
npm test

cd ../frontend
npm run build
```

The dispatch application is not changed by these features.
