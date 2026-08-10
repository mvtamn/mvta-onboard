## Problem Statement

From an operator's perspective, Route Classification, Event Map Authoring,
Direction Rule Configuration, Event Service Plan Activation, and Event AVL do
not behave as one unified Event feature. The current system has separate
authoring surfaces and different runtime scopes: AVL projection uses
`SpecialEvent` route classification, while crossing detection uses active
Service Plan membership. A draft plan can also be presented with an activation
action that the backend rejects because activation requires approval first.

This makes it unclear which routes and resources are operational, why a
vehicle is visible, and why a visible vehicle may not generate crossings or
notifications.

## Solution

Make Event the durable operating anchor. Each Event has one active Service
Plan at a time; each Service Plan represents one MVTA-local operating period
and is the executable scope for Event AVL, Event Monitoring, crossing
detection, and notifications.

Route Classification remains reusable reference data: `SpecialEvent` makes a
route eligible for assignment but does not activate monitoring. Event Planning
becomes the only lifecycle owner. Event Map Authoring maintains reusable,
versioned geofences, locations, and direction rules but cannot create or
activate plans.

All runtime consumers use one shared Scope Contract. Vehicles outside active
scope remain visible in a separate unplanned diagnostic view but do not create
crossings or notifications.

## User Stories

1. As an OCC staff member, I want to create an Event with a durable name,
   description, and owning team, so that the operational occasion has a stable
   identity.
2. As an OCC staff member, I want an Event to contain one or more sequential
   operating periods, so that recurring occasions retain one history.
3. As an OCC publisher, I want to classify a route as `SpecialEvent`, so that
   it becomes eligible for Event assignment.
4. As an OCC publisher, I want to classify a route from Event Planning, so
   that I do not lose my planning context while configuring a new route.
5. As an OCC administrator, I want route classification to remain reusable,
   so that it does not incorrectly activate a route for every occasion.
6. As an OCC administrator, I want to create reusable geofences, so that map
   boundaries can be maintained independently of a specific Event.
7. As an OCC administrator, I want to create reusable locations, so that
   direction rules can reference consistent operational destinations.
8. As an OCC administrator, I want to create reusable direction rules, so
   that heading and notification behavior is authored once and reused safely.
9. As an OCC administrator, I want reusable resources to be versioned, so
   that editing a resource cannot rewrite historical operating behavior.
10. As an OCC publisher, I want to assemble a Service Plan from classified
    routes and pinned resources, so that the Event has an explicit executable
    scope.
11. As an OCC publisher, I want a Service Plan to use MVTA-local inclusive
    operating dates, so that operations match agency calendar dates.
12. As an OCC publisher, I want activation validation to require routes,
    geofences, covered direction rules, valid dates, and no route conflicts,
    so that incomplete plans cannot become operational.
13. As an OCC publisher, I want the lifecycle to progress through draft,
    review, approved, active, and completed, so that activation is governed.
14. As an OCC operations administrator, I want to suspend an active plan, so
    that crossings and notifications stop immediately without hiding AVL
    diagnostics.
15. As an OCC publisher, I want active-plan changes to use reviewed revisions,
    so that the operational scope cannot change silently.
16. As an OCC operator, I want Event AVL to use the active Service Plan scope,
    so that the live operational map agrees with crossing detection.
17. As an OCC operator, I want the primary Event Monitoring map to show only
    active-scope vehicles, so that operational data is unambiguous.
18. As an OCC operator, I want unplanned vehicles in a separate diagnostic
    view, so that I can notice assignment gaps without treating them as active
    Event participants.
19. As an OCC dispatcher, I want an Assign to Event action for an unplanned
    vehicle, so that I can propose its route for a draft or revision without
    bypassing approval.
20. As an OCC operator, I want Event Monitoring to identify the selected Event
    and operating period, so that I know which scope the map represents.
21. As an OCC operator, I want Event Monitoring to show active routes,
    geofences, rule coverage, plan status, and health, so that configuration
    and runtime state are visible together.
22. As an OCC operator, I want crossing detection to use the same Scope
    Contract as Event AVL, so that visible operational vehicles and crossings
    cannot disagree.
23. As an OCC operator, I want a crossing with no matching direction rule to
    remain auditable without creating a notification, so that missing rule
    coverage is visible but does not create unsupported messages.
24. As an OCC administrator, I want notification mode to remain a direction
    rule concern, so that manual versus automatic delivery is independent from
    scope eligibility.
25. As an OCC operator, I want pending notifications to expire when a plan is
    suspended or completed, so that no message sends after scope ends.
26. As an OCC administrator, I want overlapping active or activatable route
    scopes rejected on the same local date, so that one route cannot silently
    operate for two Events.
27. As an OCC administrator, I want geofences reusable across Events when
    scopes are otherwise unambiguous, so that common boundaries do not need
    duplicate authoring.
28. As an OCC administrator, I want route reclassification blocked while a
    route is in an active Service Plan, so that active monitoring cannot change
    category without governance.
29. As an OCC auditor, I want Event creation, resource changes, assignments,
    lifecycle transitions, conflicts, crossings, and notification outcomes
    retained, so that operational decisions are explainable.
30. As an OCC auditor, I want completed Events and their final scopes to remain
    read-only, so that evidence is preserved.
31. As an OCC administrator, I want existing Service Plans migrated beneath
    generated Events, so that current operations retain their meaning.
32. As an OCC administrator, I want migration to preserve only known history,
    so that the system does not invent Event details.
33. As an OCC operator, I want shared AVL ingestion to remain one upstream
    Avail polling path, so that Event processing does not duplicate upstream
    calls.
34. As an OCC operator, I want active-scope suspension to stop crossings and
    notifications while keeping diagnostics, so that pauses are operationally
    safe.
35. As an OCC administrator, I want audit retention independent from raw
    telemetry retention, so that evidence survives diagnostic-data cleanup.

## Implementation Decisions

- Introduce a single Scope Contract domain seam that returns operational,
  unplanned, or out-of-scope with a reason. Projection, live-map reads,
  crossing detection, notification creation, and diagnostics must use it.
- Keep one shared upstream AVL ingestion path. Event projection consumes the
  shared AVL state rather than starting another Avail polling stream.
- Make Event the durable parent of Service Plans. A Service Plan represents
  one MVTA-local operating period; only one plan may be active for an Event at
  once.
- Make Event Planning the sole creator and lifecycle owner for Events and
  Service Plans. Use draft → review → approved → active → completed, with
  suspension and reviewed revisions.
- Remove Service Plan creation, linking, and activation from Event Map
  Authoring. That surface owns reusable geofences, locations, and direction
  rules only.
- Add inline route-classification access from Event Planning.
- Require activation and revision application to validate the complete graph:
  classified routes, pinned resource versions, direction-rule coverage,
  MVTA-local dates, and route conflicts, atomically.
- Reject route overlap between active or activatable operating periods on the
  same MVTA-local date. Permit reusable geofences where scopes are otherwise
  unambiguous.
- Keep unplanned vehicles observable in a separate diagnostic view. Assign to
  Event changes draft or revision scope only and never activates it.
- Treat unmatched crossings as audit records without notifications.
- Expire pending notifications when a plan is suspended or completed; retain
  sent records and all audit history.
- Preserve current Service Plans by creating Generated Events around them
  during migration.
- Keep Event audit history independent from 90-day raw telemetry and
  diagnostic retention.

## Testing Decisions

- The primary seam is the Scope Contract. Tests assert external classification
  behavior, not SQL layout or component implementation details.
- Build a deterministic matrix covering route category, plan lifecycle, local
  date boundaries, route/geofence links, pinned resource versions, suspension,
  conflicts, rule coverage, unmatched headings, and unplanned vehicles.
- Add integration coverage proving projection, live-map reads, crossing
  detection, and notification creation agree for the same fixture.
- Test the Service Plan lifecycle through API behavior, including invalid
  activation, conflict rejection, revision application, suspension, and
  completion.
- Test Event Map Authoring cannot activate plans and Event Planning exposes the
  only valid lifecycle path.
- Test migration preserves existing Service Plan state and scope under
  Generated Events.
- Reuse the existing REST unit-test style in `functions-restapi/src/lib` and
  the existing frontend production build/type boundaries. Add a higher-level
  integration seam rather than duplicating scope logic in separate tests.

## Out of Scope

- A second upstream AVL polling stream.
- Automatic route classification from Avail naming conventions.
- Hard deletion of Events, plans, resources, or operational history.
- Cross-Event route operation on overlapping local dates.
- New identity roles beyond the existing role system.
- Rider-facing Event features or public event communications.
- Predictive dispatch, staffing assignments, or event demand forecasting.
- Replacing Azure Maps or the existing notification transport.

## Further Notes

- ADR 0002 records the architectural decision to unify Event operations around
  one active scope.
- The existing implementation has a confirmed mismatch: Event AVL projection
  filters by route classification while crossing detection filters by active
  Service Plan.
- The existing Event Map Authoring activation control presents activation for
  draft plans even though the backend requires approved plans; the spec
  removes that competing path.
- The project currently has unrelated working-tree changes; they are outside
  this spec.
