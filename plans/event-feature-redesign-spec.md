# Event Feature Redesign Specification

## Problem Statement

The Event capability has useful working pieces—AVL ingestion, geofence
geometry, crossing detection, direction rules, notifications, audit data, and
service-plan lifecycle handlers—but they do not yet feel like one operational
product.

The current console treats a Service Plan as the primary object even though
the domain model says an Event should own one or more operating periods. Event
identity is mostly implicit, the Event AVL context is not explicit, reusable
resource authoring and operational planning are easy to confuse, and the
relationship between a crossing, a direction rule, and a notification is not
clear enough to operators.

The result is a feature that can perform parts of the workflow but does not
give staff confidence that Event Planning, Event AVL, Event Administration,
AVL projection, crossing detection, notification delivery, and audit all use
the same operating scope.

## Solution

Reshape the Event capability around a first-class Event and its sequential
operating periods.

An Event is the stable human-facing identity of a public-service occasion. A
Service Plan is a bounded operating period under that Event. The active plan
is the executable scope for Event AVL, crossings, and operational actions.

Event Planning owns the workflow from Event creation through activation,
reviewed revisions, suspension, completion, and history. Event Administration
owns reusable geofences, transit locations, direction rules, permissions,
integrations, and system settings. Event AVL requires a selected Event
operating context and separates active-scope vehicles from diagnostic or
unplanned vehicles.

A geofence crossing is an operational observation. An operational rule then
decides whether the observation produces no action, manual review, or automatic
Teams delivery. Active operating scope and notification behavior are separate
decisions, and every decision is auditable.

## User Stories

1. As an Event planner, I want to create a first-class Event, so that the
   occasion has a stable identity independent of any one Service Plan.
2. As an Event planner, I want to provide an Event name and description, so
   that staff understand what the operation is for.
3. As an Event planner, I want to identify the owning team, so that operational
   accountability is clear.
4. As an Event planner, I want to create one or more sequential operating
   periods under an Event, so that a multi-day or phased occasion can be
   managed without creating unrelated Events.
5. As an Event planner, I want to define MVTA-local start and end timestamps,
   so that overnight operations and midnight boundaries are handled correctly.
6. As an Event planner, I want to see the current lifecycle state of an Event
   and each operating period, so that I know what is proposed, approved, live,
   suspended, completed, or archived.
7. As an Event planner, I want to assemble a Service Plan from multiple routes,
   geofences, locations, and direction rules, so that the complete operating
   scope is visible in one place.
8. As an Event planner, I want to select reusable administrative resources,
   so that recurring stations, venues, garages, lots, and corridors do not
   need to be recreated for every Event.
9. As an Event planner, I want to open the administrative authoring workflow
   for a missing resource and return to Planning afterward, so that resource
   ownership remains clear without losing my planning context.
10. As an authorized planner, I want to see whether a route is classified as
    `SpecialEvent`, so that I know whether it is eligible for Event scope.
11. As an authorized planner, I want to classify an eligible route from the
    Planning workflow, so that route setup does not require abandoning the
    Event context.
12. As an Event planner, I want effective dates and route conflicts surfaced
    before activation, so that an Event cannot accidentally overlap another
    active operation.
13. As a reviewer, I want to validate that a proposed plan contains valid
    routes, dates, geofences, locations, and covered direction rules, so that
    incomplete scope cannot become operational.
14. As a reviewer, I want to submit and approve a proposed operating period,
    so that activation is an explicit controlled decision.
15. As an authorized operator or administrator, I want to activate an approved
    operating period, so that Event AVL and crossing detection begin from a
    deliberate operational moment.
16. As an operator, I want an active Event to use an immutable scope snapshot,
    so that later administrative edits cannot silently change live operations.
17. As an Event administrator, I want to edit reusable resources independently,
    so that future Events can use improved definitions without rewriting an
    active or historical Event.
18. As an Event planner, I want to propose a revision to an active operating
    period, so that mid-event changes follow the same review and approval
    controls as initial activation.
19. As an operator, I want to suspend an Event, so that crossings and
    notifications stop immediately while diagnostic AVL remains available.
20. As an operator, I want to complete an operating period, so that it no
    longer drives live operations while its history remains available.
21. As an Event AVL operator, I want to select one Event operating context,
    so that the map, vehicles, crossings, and notifications are unambiguous.
22. As an Event AVL operator, I want to see active-plan vehicles as the primary
    operational view, so that I can focus on vehicles currently in scope.
23. As an Event AVL operator, I want a separate diagnostic view of unplanned
    SpecialEvent vehicles, so that I can identify possible assignment issues
    without treating them as active participants.
24. As an Event AVL operator, I want independent map layers for vehicles,
    diagnostic vehicles, geofences, locations, routes, crossings, and
    notification state, so that the map explains the operational situation.
25. As an Event AVL operator, I want to see feed freshness and component health,
    so that stale or failed data is not mistaken for current operational truth.
26. As an Event AVL operator, I want to propose adding an out-of-scope vehicle
    or route to a draft plan or revision, so that the issue can follow normal
    review rather than bypassing controls.
27. As an Event administrator, I want to draw and edit polygon geofences on a
    map, so that areas around stations, venues, lots, and checkpoints can be
    defined precisely.
28. As an Event administrator, I want to place point locations on a map, so
    that transit stations, garages, entrances, and destinations are distinct
    from polygon areas.
29. As an Event administrator, I want real-time latitude and longitude while
    drawing or placing resources, so that map authoring is precise and
    verifiable.
30. As an Event administrator, I want to toggle map layers while authoring, so
    that existing resources can be compared without cluttering the map.
31. As an Event administrator, I want to author direction rules using compass
    directions or custom ranges, so that operational configuration is readable
    to staff and still supports precise headings.
32. As an Event administrator, I want a direction rule to describe entry or
    exit, destination, alert text, priority, and action, so that the form
    expresses operational intent rather than database fields.
33. As an Event administrator, I want multiple rules on one geofence, so that
    different approaches and departures can have distinct operational meaning.
34. As an Event administrator, I want deterministic rule precedence, so that
    overlapping rules produce the same result in detection, notification, and
    audit.
35. As an Event AVL operator, I want every crossing observation retained, so
    that unmatched or non-alerting activity remains diagnosable.
36. As an Event AVL operator, I want an observation to be evaluated against
    the active Event scope, so that inactive plans and unrelated routes cannot
    create operational actions.
37. As an Event AVL operator, I want a matching observation to produce no
    action when configured, so that not every meaningful crossing creates an
    alert.
38. As an Event AVL operator, I want a matching observation to enter manual
    review when configured, so that staff can validate operational context
    before delivery.
39. As an Event AVL operator, I want a matching observation to trigger automatic
    Teams delivery when configured, so that urgent operational information can
    be distributed without manual delay.
40. As an Event AVL operator, I want notification status to distinguish pending,
    acknowledged, sent, failed, dismissed, and expired, so that delivery state
    is never ambiguous.
41. As an Event AVL operator, I want failed delivery to remain retryable or
    visibly terminal according to policy, so that failures are not recorded as
    successful sends.
42. As an Event AVL operator, I want pending notifications to expire when an
    Event scope ends, so that stale alerts cannot be sent after suspension or
    completion.
43. As an authorized publisher, I want notification actions and delivery
    outcomes audited, so that the organization can reconstruct who acted and
    what happened.
44. As an Event administrator, I want one centrally configured Teams
    destination initially, so that delivery credentials are not duplicated in
    individual rules.
45. As an Event administrator, I want permissions to distinguish authoring,
    reviewing, operating, and administration, so that staff can perform their
    duties without receiving unrelated authority.
46. As a reader or compliance user, I want completed Events and their history
    retained, so that operational decisions can be reviewed later.
47. As a migration operator, I want existing Service Plans represented by
    generated Events without inventing unknown history, so that existing
    records remain usable and honest.
48. As an operator, I want the complete path from Event scope to observation to
    operational action visible in one system, so that Event Planning, Event
    Administration, and Event AVL can be trusted to agree.

## Implementation Decisions

- Make Event the first-class planning object. A Service Plan is a bounded
  operating period owned by an Event.
- Support sequential operating periods under one Event, with at most one
  active plan governing a route at a time.
- Use MVTA-local start and end timestamps for operating scope rather than
  relying only on dates.
- Keep Event Planning as the owner of Event creation, operating-period setup,
  resource selection, review, approval, activation, revision, suspension,
  completion, and history.
- Keep Event Administration as the owner of reusable geofences, locations,
  direction rules, permissions, integrations, and system settings.
- Provide Planning selectors and links into Administration instead of creating
  a second reusable-resource editor inside the plan builder.
- Treat `SpecialEvent` route classification as eligibility, not activation.
  Active Service Plan membership, operating timestamps, and resource coverage
  determine operational participation.
- Require route, geofence, location, direction-rule, action, and relevant
  classification meaning to be captured in an immutable operating-scope
  snapshot when a plan or approved revision becomes active.
- Prevent direct mutation of active scope. Active changes must be proposed as a
  revision, reviewed, approved, and explicitly applied.
- Give Event AVL an explicit selected Event operating context. Global summaries
  may exist, but operational actions must identify the context they affect.
- Separate active-plan vehicles from unplanned or diagnostic SpecialEvent
  vehicles in both map presentation and action permissions.
- Provide independent Event AVL layers for active vehicles, diagnostic
  vehicles, geofences, locations, routes, crossings, and notification state.
- Treat a geofence crossing as an operational observation. Rule evaluation is a
  subsequent decision that may select no action, manual review, or automatic
  Teams delivery.
- Keep direction rules attached to geofences, with transition, compass/custom
  heading, destination, descriptive alert text, priority, and action behavior.
- Use deterministic precedence for multiple matching rules and preserve the
  matched-rule meaning with each observation/action record.
- Use one centrally configured Teams destination initially. Rules select action
  behavior and content but do not store delivery credentials.
- Model notification state explicitly: pending, acknowledged, sent, failed,
  dismissed, and expired. Only confirmed delivery may produce `sent`.
- Stop crossings and notifications when an operating period is suspended or
  completed, while retaining AVL diagnostics and historical records.
- Fail closed for operational actions when required feed or scope data is
  stale, while exposing component health and last-success information.
- Preserve generated Events created for legacy Service Plans. Generated values
  must be identified as migration-derived and must not fabricate unknown facts.
- Preserve existing working geometry, AVL, queue, audit, and policy modules
  where their contracts can be aligned with the Event operating scope.
- Update API contracts to expose Event identity, operating periods, scope
  snapshots, revision actions, selected Event AVL context, diagnostic vehicle
  assignment proposals, observation/action state, and component health.
- Update the relational model as necessary to represent Event identity,
  timestamped operating periods, immutable scope snapshots, pinned resource
  versions, revision contents, proposed assignments, operational observations,
  notification lifecycle state, and audit causality.
- Keep reusable resource edits independent from active-scope snapshots.
- Do not introduce rider-facing alert publication in this redesign; Teams is
  the initial operational delivery boundary.

## Testing Decisions

- Tests must verify externally observable behavior and state transitions, not
  implementation details such as individual SQL statements or React component
  structure.
- Use the existing pure domain seam for Event scope classification, direction
  rule validation and precedence, matched-rule snapshots, geometry, heading
  ranges, observation freshness, transition confirmation, and notification
  retry/expiry policy.
- Add an end-to-end API seam covering Event creation, operating-period setup,
  resource assembly, review, approval, activation, revision, suspension,
  completion, and history.
- Add API coverage proving that active scope remains unchanged after reusable
  resources are edited and changes only after an approved revision is applied.
- Add API coverage proving route conflicts, invalid timestamps, missing route
  classification, missing geofences, missing direction rules, and incomplete
  snapshots block activation.
- Add API coverage proving the shared scope contract is consistent for Event AVL
  projection, active-map reads, crossing detection, diagnostics, and
  notification creation.
- Add API coverage for planned versus unplanned vehicles and proposed
  assignments, including the requirement that assignments do not change active
  scope immediately.
- Add API coverage for observation-to-action behavior: no action, manual
  review, automatic delivery, unmatched rule, stale feed, and suspended scope.
- Add concurrency coverage proving one notification cannot produce duplicate
  outbound delivery attempts when multiple operators act at the same time.
- Add lifecycle coverage proving pending notifications expire on suspension or
  completion and that failed delivery is not recorded as sent.
- Add audit coverage proving Event configuration, scope changes, observations,
  assignments, lifecycle actions, and notification outcomes are reconstructable.
- Add a focused browser acceptance path covering Event creation, operating
  period setup, resource selection, activation controls, Event AVL context,
  layer visibility, diagnostic vehicles, and notification state.
- Retain the repository's existing Node test style for pure library tests and
  the existing frontend build/type checks as supporting validation.
- Verify migrations against an empty schema and a representative legacy plan,
  including generated Event creation and preservation of existing records.

## Out of Scope

- Rider-facing alert publication or customer notification channels.
- Multiple rule-owned Teams webhooks or per-rule credential management.
- Staff assignment rosters, block management, headway watchlists, and
  dispatch workforce planning.
- Traffic-condition modeling, predicted-delay modeling, and automated
  detour orchestration.
- Post-event planned-versus-operated performance reporting.
- Replacing the general fixed-route AVL/CAD product.
- Rebuilding the working geometry engine or Avail feed integration without a
  demonstrated contract need.
- Hard deletion of completed Events, plans, observations, notifications, or
  audit records.

## Further Notes

The current implementation should be treated as a partial operational
foundation, not as the final UX or contract. The redesign should begin with
the Event operating-context and workflow seam, then align the runtime
consumers around the same scope contract before adding more operational
features.

The expected delivery order is:

1. First-class Event and operating-period workflow.
2. Timestamped plans, scope snapshots, and reviewed revisions.
3. Event AVL context and layered operational presentation.
4. Observation-to-operational-action pipeline and notification lifecycle.
5. Audit, health, migration compatibility, and end-to-end coverage.

Implementation should not proceed as a series of isolated UI field additions.
Each slice should demonstrate that Event Planning, Administration, Event AVL,
crossing detection, notifications, and audit agree on the same operating
context.
