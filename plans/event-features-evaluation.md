# Event Features Evaluation

**Evaluation date:** 2026-08-10  
**Scope:** Event operating context, Event Planning, Event Monitoring, AVL
projection, geofencing, notifications, audit, and telemetry health.

This is an implementation evaluation based on the current source and migrations.
`plans/event-monitoring-current-functionality.md` remains the detailed operator
reference; this document records the feature assessment, verified behavior, and
recommended follow-up.

## Executive assessment

The event capability is a usable operational foundation, not a complete event
management product. The strongest delivered path is:

1. classify a route as `SpecialEvent`;
2. author reusable geofences, locations, and direction rules;
3. assemble and activate an Event Service Plan;
4. project eligible Avail AVL vehicles;
5. detect confirmed geofence transitions; and
6. review or automatically send Teams notifications.

The shared-scope direction in `CONTEXT.md` and ADR 0002 is now reflected in the
main runtime path: event projection and crossing detection require an active,
date-valid plan with linked active geofences and direction rules. The UI still
exposes only a thin version of the durable Event concept, and several failure
paths need hardening before this should be treated as a fully dependable live
operations system.

## Feature scorecard

| Feature | Status | Evaluation |
|---|---|---|
| Route classification | Delivered | Admin can classify routes as `FixedRoute`, `SpecialEvent`, or `OnDemand`; effective dates and optimistic concurrency are supported by the API. |
| Event identity | Partial | `Events` exists and legacy plans can be attached to generated Events, but Event Planning creates/operates primarily on service plans and does not give staff a first-class Event identity workflow. |
| Reusable map resources | Delivered | Staff can draw/deactivate geofences, place/deactivate locations, and configure direction rules. Location partial updates now preserve omitted fields. |
| Direction-rule policy | Delivered | Transition, heading range, priority, destination, send mode, uniqueness, and matched-rule snapshots are implemented and tested. |
| Service-plan lifecycle | Delivered with scope limits | Draft → review → approved → active → suspended/completed is guarded server-side; activation validates routes, geofences, dates, and route conflicts. |
| Active-plan revisions | Partial | Revision creation, review, approval, and application exist. Resource version pinning and immutable active-scope semantics are represented in the domain model but are not fully evidenced in the current schema/runtime implementation. |
| Event AVL ingestion | Delivered | Shared Avail fetch feeds both general AVL and event projection; separate database leases allow independent cadence. Projection is gated by active plan, local operating date, active geofence, and direction-rule coverage. |
| Live Event Monitoring | Delivered | Azure Maps, markers, filters, vehicle enrichment, freshness, and explicit health/status data are present. Current display is admin-only. |
| Geofence crossing detection | Delivered with performance risk | Polygon containment, stale-report rejection, two-observation transition confirmation, active-scope filtering, and rule selection are implemented. The vehicle × geofence query pattern may become expensive at event scale. |
| Notification review and Teams delivery | Partial | Manual/auto modes, queueing, retries, expiry, failure states, and dismissal exist. Delivery claiming is not atomic before the outbound POST, so concurrent sends can still duplicate a Teams message. |
| Audit stream | Delivered, limited | Classification edits, crossings, notification actions, and lifecycle/resource changes are surfaced through record-derived audit views. It is not yet a complete immutable Event audit covering every scope, assignment, conflict, and revision decision. |
| Telemetry health and retention | Delivered | Component health, diagnostics, maintenance status, 90-day position/diagnostic retention, and pending-notification counts are available. Crossing state and notification history are retained separately. |
| Rider alert integration | Not part of Event Monitoring | Event geofence notifications target Teams. The feature does not automatically publish rider alerts, which is consistent with the current product boundary. |
| Special-event operations workspace | Not delivered | Staff assignments, block/checkpoint/headway watchlists, traffic conditions, predicted delays, missing-service analysis, and post-event planned-versus-operated reporting remain future work. |

## Verified runtime flow

```text
RouteClassification + active Event Service Plan
              ↓
      Avail AVL shared ingestion
              ↓
       Event position projection
              ↓
  active geofence / date / route scope
              ↓
    confirmed enter/exit transition
              ↓
  matched direction-rule snapshot
              ↓
   Service Bus → Teams notification
```

Important boundaries:

- A `SpecialEvent` classification makes a route eligible; it does not activate
  operations by itself.
- A visible live-map vehicle is not automatically an event participant. Crossing
  detection requires active service-plan scope.
- An unmatched crossing is retained for diagnostics but does not create a
  notification.
- Automatic detection never publishes a rider-facing alert.

## Strengths

- The runtime vocabulary and scope predicate are substantially clearer than the
  original classification-only design.
- Local MVTA operating dates are used for classification and plan validity.
- Old AVL observations are rejected, and transition detection requires two
  observations on the new side, reducing duplicate and GPS-noise crossings.
- Direction rules are selected deterministically and their meaning is snapshotted
  on the crossing record.
- Teams failures are represented as retryable or terminal states rather than
  silently reported as successful delivery.
- Event-specific cadence no longer forces the general Avail AVL lease to use the
  same interval.
- Health and retention are explicit operational features rather than implicit
  maintenance assumptions.

## Priority findings

### P0 — Make outbound notification claiming atomic

`eventGeofenceNotifications.ts` reads a pending row, posts to Teams, and then
updates the row. Two concurrent approvals can both pass the pending check and
both post. The same race exists for automatic delivery in
`eventGeofenceNotify.ts`.

**Recommendation:** claim the row in one conditional update before posting, using
an intermediate `sending` state or a lease token. On success mark `sent`; on
failure release or schedule the claim. Add a concurrency test that proves one
crossing produces at most one outbound attempt at a time.

### P1 — Finish the durable Event operating model in the UI

The database has `Events` and `EventServicePlans.event_id`, but the console
creates and selects service plans directly. Staff cannot clearly create an Event,
view its operating periods, or understand which Event owns a plan. This weakens
the domain model adopted by ADR 0002 and makes recurring occasions harder to
manage.

**Recommendation:** make Event the top-level planning selector; create a service
plan as an operating period under that Event; show owning team, local dates,
active plan, revisions, and archive/history state in Event Planning.

### P1 — Complete immutable resource versioning

The domain documentation requires pinned resource versions for active plans, but
the visible migrations link plans directly to reusable geofence/location rows.
Editing a reusable resource can therefore change the meaning of a currently
active scope unless the revision path is enforced elsewhere.

**Recommendation:** store resource snapshots or version IDs in plan/revision link
tables and make runtime consumers read the pinned version. Add a test proving an
active plan is unchanged after a reusable resource edit.

### P1 — Add integration tests around SQL-backed transitions

The pure event tests are useful, but they do not exercise the highest-risk seams:
plan activation/conflict checks, projection gating, crossing persistence,
notification claiming, retry state transitions, or migration compatibility.

**Recommendation:** add database-backed tests, or a narrowly scoped repository
test double, for the end-to-end event path and the notification race. Keep the
existing pure tests for geometry and policy logic.

### P2 — Bound crossing-detection work

Detection currently iterates position/fence combinations and performs several
queries per pair. This is straightforward and correct at small volume, but its
cost grows with the number of vehicles and geofences.

**Recommendation:** load current state and rules in batches, use a spatial SQL
predicate or indexed candidate bounding boxes, and measure invocation duration
against the configured poll interval before a large event.

### P2 — Improve operator observability of partial failure

Health data is available in the API, but the Event Monitoring page does not make
every partial failure equally prominent; some secondary feed failures leave old
content on screen. Operators need to distinguish fresh data, stale data, failed
ingestion, failed projection, and delayed notification delivery.

**Recommendation:** show component-level health badges with last-success time,
age, and error detail next to the map, crossing feed, and notification queue.

### P2 — Clarify effective polling blast radius

The event lease and shared AVL lease are now separate, but the configured event
interval still controls event projection and crossing latency, while the shared
Avail fetch has its own cadence. The Admin label should explain API volume,
freshness, and detection latency together.

## Documentation corrections

The existing current-functionality document should be refreshed in two areas:

- Its older known-gap list says active-plan gating is absent from projection and
  live-map reads; current source now applies the gate in both paths.
- It says location rename/deactivation and multi-rule matching are broken; current
  source contains partial-location update handling and selects the lowest-priority
  matching rule from all candidates.

Those items should be moved to a historical/deviation section or removed after a
quick production verification. The remaining current-functionality content is a
good operator-oriented reference and should not be duplicated wholesale here.

## Verification performed

- REST API TypeScript build: passed.
- REST API tests: **260 passed, 0 failed**.
- Frontend workspace typecheck: failed before application checking with
  TypeScript project-reference error `TS6310` because the referenced shared
  project is configured incompatibly with `--noEmit`. This is a build/tooling
  configuration issue surfaced by the check, not evidence of an Event UI type
  error.

## Recommended delivery order

1. Fix atomic notification claiming and add concurrency coverage.
2. Reconcile Event Planning UI with the durable Event/operating-period model.
3. Enforce resource version pinning for active plans and revisions.
4. Add SQL/integration coverage for activation, projection, crossings, and
   delivery retries.
5. Add operator-visible component health and load-test detection at expected
   event scale.
6. Treat the broader event operations workspace and post-event reporting as a
   separate product increment.
