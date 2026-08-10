# Event Operating Model — Confirmed Design

## Decision

Event operations are organized around a durable **Event**. Each Event has one
active **Service Plan** at a time. A Service Plan is one MVTA-local operating
period and the executable scope for AVL visibility, crossing detection, and
notifications.

**Route Classification** remains reusable reference data. `SpecialEvent` makes
a route eligible for assignment; it does not activate monitoring.

## Canonical workflow

1. Classify a route as `SpecialEvent`.
2. Create or select an Event operating period.
3. Author or select reusable geofences, locations, and direction rules.
4. Build the Service Plan with routes and pinned resource versions.
5. Validate date ranges, rule coverage, and route conflicts.
6. Submit, approve, and activate the Service Plan.
7. Event AVL, Event Monitoring, crossings, and notifications consume the same
   active scope.
8. Change an active scope only through a reviewed revision.
9. Suspend or complete the period; retain its audit and operational history.

## Scope contract

An operational vehicle must satisfy all of the following:

- its route is classified `SpecialEvent`;
- its route is linked to the selected Event's active Service Plan;
- the current MVTA-local date is within the Service Plan's inclusive period;
- the relevant geofence is linked to that same active plan;
- the geofence has applicable pinned direction rules.

Projection, live-map reads, crossing detection, notifications, and unplanned
diagnostics must agree on this contract.

## UI ownership

### Event Planning

The only screen that creates Events, assembles Service Plans, submits/reviews/
approves/activates plans, creates revisions, and suspends/completes periods.
Route Classification should be reachable inline so route setup does not force
staff to lose planning context.

### Event Map Authoring

Maintains reusable geofences, locations, and direction rules only. It must not
create or activate Service Plans.

### Event Monitoring

Shows one selected Event operating period as the operational map context. It
shows active-scope vehicles in the primary view and unplanned vehicles in a
separate diagnostic section, alongside plan, AVL, projection, crossing, and
notification health.

## Edge cases

- A crossing with no matching direction rule is retained for audit but creates
  no notification.
- Route overlap between active or activatable operating periods on the same
  MVTA-local date is rejected.
- Reusable resource edits create new versions; active plans retain pinned
  versions.
- Suspension stops crossings and notifications immediately but leaves AVL
  diagnostics available.
- Pending notifications become auditable expired records when scope ends.
- Operational records are completed or archived, not hard-deleted.

## Migration

Each existing Service Plan becomes a child operating period of a generated
Event. Existing names, scope, lifecycle state, and known dates are preserved;
unknown historical Event details are not invented.

## Known implementation findings

- `projectEventPositions` currently filters by route classification while
  `detectEventGeofenceCrossings` filters by active Service Plan.
- `EventResourceMapEditor` offers activation for draft plans even though the
  backend requires `approved` before `active`.
- The deployed health route may briefly return 404 during propagation, then
  becomes reachable; this is separate from the scope mismatch.
