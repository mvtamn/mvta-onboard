# Event Monitoring and AVL — Implementation Specification

## Problem Statement

Event Monitoring currently shares an Avail AVL polling gate with general AVL
ingestion. Changing the event interval therefore changes freshness, upstream
API volume, and behavior for unrelated AVL consumers. The current event
position read also requires active service-plan membership, which conflates
live visibility with operational event participation.

The module needs a clear contract between shared AVL ingestion, event
projection, live visibility, crossing detection, notification delivery, and
administrative service-plan changes. It must remain useful for live operations
while being explicit about stale data, missed observations, partial failures,
and the provenance of enriched fields.

## Solution

Keep one shared Avail AVL ingestion path as the sole upstream polling stream.
Derive an event-specific operational projection from that shared data, with
event projection and crossing detection independently paced and observable.

Live Event Monitoring will show fresh, in-bounds vehicles on active,
date-valid `SpecialEvent` classifications, whether or not a service plan is
active. Crossing detection and notifications will use only routes and
geofences in active service-plan scope.

The system will add explicit freshness and health semantics, idempotent and
bounded notification delivery, auditable plan/configuration changes, validated
geometries, bounded raw-position retention, and robust handling for delayed,
out-of-order, malformed, duplicated, and noisy AVL observations.

## User Stories

1. As an OCC operator, I want to see every fresh, eligible `SpecialEvent`
   vehicle on the live map, so that I can monitor event service before a plan
   is activated.
2. As an OCC operator, I want live visibility to be independent of service-plan
   activation, so that setup and diagnosis do not hide classified vehicles.
3. As an OCC operator, I want active service plans to determine which routes
   and geofences participate in crossing detection, so that only operationally
   in-scope resources generate crossings.
4. As an OCC operator, I want a vehicle to appear only once when multiple
   active plans include its route, so that overlapping plans do not duplicate
   the operational view.
5. As an OCC operator, I want overlapping plans to be treated as a union of
   scope, so that a route remains monitored when any applicable plan is active.
6. As an OCC operator, I want a vehicle removed from event processing when its
   latest observed route becomes fixed or unclassified, so that old event
   eligibility does not linger.
7. As an OCC operator, I want report age displayed separately from UI load
   time, so that I can distinguish old AVL data from a slow browser refresh.
8. As an OCC operator, I want a vehicle marked stale after three minutes and
   retained briefly for diagnosis, so that disappearing telemetry is visible
   without leaving stale vehicles indefinitely.
9. As an OCC operator, I want stale current-position rows cleaned up after a
   bounded window, so that current state remains operationally meaningful.
10. As an OCC operator, I want the Event Monitoring page to show separate
    health/freshness states for shared AVL ingestion, event projection,
    crossing detection, and notifications, so that a partial failure is clear.
11. As an OCC operator, I want a failed secondary feed to retain its last
    successful contents with an error and timestamp, so that one failed API
    does not erase useful context.
12. As an OCC operator, I want manual refresh to load the latest available
    projection without forcing an upstream Avail call, so that refresh does
    not bypass polling controls.
13. As an OCC administrator, I want event polling/projection cadence
    configurable independently from general AVL cadence, so that geofence
    precision does not silently change unrelated AVL cost or freshness.
14. As an OCC administrator, I want the effective event interval visible in
    the UI, so that I understand the precision/cost trade-off.
15. As an OCC administrator, I want safe server-side interval bounds, so that
    an accidental setting cannot hammer the upstream feed.
16. As an OCC administrator, I want one shared AVL upstream fetch, so that the
    system avoids duplicate Avail polling streams.
17. As an OCC administrator, I want general AVL cadence independently
    configurable, so that shared ingestion policy can evolve without coupling
    it to event behavior.
18. As an OCC operator, I want crossing detection to use only observations
    within an interval-aware detection window, so that delayed cycles do not
    automatically exclude all candidates.
19. As an OCC operator, I want the UI to state that relaxed polling can miss a
    boundary visit, so that the system does not imply guaranteed detection.
20. As an OCC operator, I want a vehicle already inside a geofence when scope
    becomes active to seed state without creating a false enter crossing.
21. As an OCC operator, I want a route or geofence added to an active plan to
    seed current state without a retroactive crossing.
22. As an OCC administrator, I want active-plan modifications to use an
    explicit modify/review/approval flow, so that operational scope does not
    change invisibly.
23. As an OCC administrator, I want the old approved plan scope to remain
    active while a revision is under review, so that an unfinished edit cannot
    interrupt operations.
24. As an OCC administrator, I want approved removal of a resource to stop
    new detection immediately, while retaining the historical record.
25. As an OCC administrator, I want suspended plans to stop processing without
    losing configuration or history.
26. As an OCC administrator, I want a reviewed resume action for suspended
    plans, so that resumption is deliberate and auditable.
27. As an OCC administrator, I want route classifications to use the MVTA
    local service date, so that UTC midnight does not change eligibility at the
    wrong operational time.
28. As an OCC administrator, I want classification start and end dates to be
    inclusive, so that a route is eligible for its complete configured window.
29. As an OCC administrator, I want reused route IDs represented by separate,
    non-overlapping classification periods, so that historical events remain
    explainable.
30. As an OCC administrator, I want overlapping classification periods for
    one route rejected, so that read-time eligibility is never ambiguous.
31. As an OCC administrator, I want optimistic concurrency on configuration
    edits, so that one administrator cannot silently overwrite another.
32. As an OCC operator, I want a crossing recorded even when no direction rule
    matches, so that observed movement is not lost.
33. As an OCC operator, I want unmatched crossings to avoid creating noisy
    notification drafts, so that the review queue contains actionable items.
34. As an OCC operator, I want a crossing detected without a heading when the
    geometry changes, so that missing heading does not suppress movement data.
35. As an OCC operator, I want direction rules skipped when heading is missing,
    so that the system does not invent directional evidence.
36. As an OCC administrator, I want valid polygon holes honored or rejected
    during authoring, so that geometry cannot silently produce false crossings.
37. As an OCC administrator, I want malformed, self-intersecting, or invalid
    polygons rejected before activation, so that runtime detection remains
    predictable.
38. As an OCC operator, I want GPS boundary jitter debounced, so that one bus
    does not flap between enter and exit repeatedly.
39. As an OCC operator, I want out-of-order reports excluded from current and
    crossing state, so that an old observation cannot move the system backward.
40. As an OCC operator, I want delayed valid reports retained diagnostically,
    so that ingestion investigations can explain what arrived late.
41. As an OCC operator, I want out-of-bounds and malformed records counted or
    sampled diagnostically, so that rejected telemetry is observable without
    polluting normal state.
42. As an OCC operator, I want speed enrichment failures to leave the vehicle
    visible, so that missing GTFS-Realtime identity matching does not hide a
    bus.
43. As an OCC operator, I want field provenance available for AVL,
    GTFS-Realtime, Pullout Reports, and fallback calculations, so that missing
    or disputed values can be investigated.
44. As an OCC operator, I want Avail `O`/`I` direction fallbacks labeled as
    convenience data rather than verified compass evidence, so that I do not
    over-trust inferred direction.
45. As an OCC operator, I want manual notifications to remain pending until
    explicitly approved, so that no message is sent unintentionally.
46. As an OCC administrator, I want narrowly scoped auto-send rules, so that
    only trusted direction rules bypass review.
47. As an OCC operator, I want missing/invalid Teams configuration to create a
    visible pending or failed item, so that an auto-send failure is not hidden.
48. As an OCC operator, I want transient notification failures retried with
    bounded backoff for 24 hours, so that temporary outages recover without
    infinite retries.
49. As an OCC operator, I want permanent notification failures surfaced for
    explicit action, so that configuration errors do not retry forever.
50. As an OCC operator, I want notification delivery idempotent by crossing
    occurrence, so that queue retries cannot duplicate Teams messages.
51. As an OCC operator, I want pending manual notifications to expire after a
    defined window, initially 24 hours, so that old drafts are not sent late.
52. As an OCC operator, I want generated notification text immutable before
    approval, so that the approved message remains deterministic and auditable.
53. As an OCC administrator, I want route, plan, polling, geofence, rule,
    crossing, and notification actions in one categorized audit history, so
    that operational changes can be reconstructed chronologically.
54. As an auditor, I want audit entries append-only, so that historical actions
    cannot be rewritten.
55. As an OCC operator, I want audit history retained longer than raw positions,
    so that decisions remain explainable after telemetry pruning.
56. As an OCC administrator, I want raw event-position history retained for 90
    days, so that investigations have a bounded diagnostic window.
57. As an OCC operator, I want retention cleanup observable, so that failed
    pruning cannot silently grow storage.
58. As an OCC operator, I want persistence in UTC and display in MVTA local
    time, so that timestamps remain consistent across services and useful in
    the console.
59. As an OCC operator, I want an active vehicle’s applicable plan(s)
    inspectable, so that overlapping scope is understandable.
60. As an OCC administrator, I want an explicit readiness checklist covering
    failure isolation, freshness, retries, geometry, audit, retention, and
    upstream rate-limit evidence, so that the feature is not considered ready
    based only on a happy-path map demo.

## Implementation Decisions

- Use the existing shared Avail AVL ingestion path as the sole upstream fetch
  seam. Do not add a second Avail polling stream.
- Separate shared ingestion cadence from event projection/crossing cadence and
  from frontend refresh cadence. The event cadence must not control unrelated
  AVL consumers.
- Treat the shared AVL projection as the source of truth. Maintain an
  event-specific current/history projection for event queries and detection,
  derived from shared ingestion.
- Make the event projection and crossing detector independently failing and
  observable. Event failures must not prevent general AVL updates.
- Keep live-map eligibility based on active, date-valid `SpecialEvent`
  classification, report freshness, and operating-region bounds. Do not require
  active service-plan membership for visibility.
- Keep crossing and notification eligibility based on active service-plan
  membership. Multiple active plans form a union; vehicles and physical
  vehicle/geofence transitions are deduplicated.
- Use report timestamp for vehicle freshness and ingestion/observation time for
  pipeline health. Track watermarks per vehicle, preferably per vehicle/route
  when route identity affects eligibility.
- Mark positions stale after three minutes, retain current rows for a bounded
  diagnostic window initially recommended at 15 minutes, then remove them.
- Make the detector window interval-aware, initially `max(3 minutes, 2 ×
  effective interval)`, while documenting that relaxed polling can miss an
  entire unobserved geofence visit.
- Treat first observation, plan activation, and resource addition as state
  seeding only. Emit crossings only for subsequent stable state flips.
- Add a documented boundary-stability/debounce rule, initially requiring two
  consecutive observations on the new side or an equivalent short stability
  window.
- Treat a point on a geofence boundary as inside. Support valid GeoJSON holes;
  reject malformed or self-intersecting polygons during authoring.
- Ignore out-of-order reports for current/crossing state while retaining valid
  delayed data for diagnostics/history. Track rejected telemetry through
  counters or sampled error records, not normal operational state.
- Use MVTA local date semantics for classification windows, with inclusive
  start/end dates. Model reused route IDs as separate non-overlapping periods
  and reject ambiguous overlaps.
- Keep service-plan lifecycle actions explicit. Active-plan changes use an
  explicit modify/review/approval flow; existing approved scope remains active
  until the revision is approved. Suspension pauses processing and supports an
  audited resume.
- Apply valid configuration changes on the next processing cycle and snapshot
  rule/send-mode/message data at crossing or notification creation time.
- Use optimistic concurrency for administrative edits and append-only audit
  records. Audit classification, polling, plan, resource, geofence, rule,
  crossing, and notification changes, with before/after scope for revisions.
- Keep notifications manual by default. Permit per-rule auto-send, downgrade
  to visible pending/failed state when Teams is unavailable, retry transient
  failures for 24 hours with bounded backoff, and make delivery idempotent.
- Expire pending manual notifications after 24 hours; preserve expired and
  failed records in audit/history.
- Retain raw event positions for 90 days and retain audit history for at least
  one year. Make cleanup automatic and health-observable.
- Expose data provenance in diagnostic detail without making the primary
  operator view unnecessarily dense.

### Primary seams

1. **Shared AVL ingestion and event projection seam** — the highest seam for
   one upstream fetch, timestamp/watermark handling, classification, event
   projection, retention, and independent failure reporting.
2. **Event processing seam** — crossing detection, plan-scope union/deduplication,
   geometry stability, rule snapshotting, and notification enqueueing.
3. **Event Monitoring API/UI seam** — freshness/health/provenance contracts,
   operator filters, plan-scope inspection, secondary-feed errors, and manual
   notification actions.

## Testing Decisions

- Test external behavior at the highest seam possible. Prefer pure domain
  behavior and projection/detection contracts over implementation-specific SQL
  call counts or component internals.
- Extend the existing AVL mapping/poller test style to cover shared ingestion,
  event projection, stale cleanup, route/classification changes, timestamp
  ordering, rejection diagnostics, and failure isolation.
- Extend the existing geofence tests to cover boundary inclusion, holes,
  invalid/self-intersecting geometry, heading wraparound, missing heading,
  debounce behavior, first-observation seeding, plan activation, and out-of-
  order reports.
- Add service-plan lifecycle tests covering active-plan modification/review,
  suspension/resume, resource additions/removals, overlapping plans, union
  scope, and deduplicated crossings.
- Add API contract tests for visibility without a plan, active-plan crossing
  scope, stale/health diagnostics, provenance, partial-feed errors, and
  optimistic-concurrency failures.
- Add notification tests for unmatched rules, rule/message snapshots,
  manual approval, expiry, auto-send fallback, transient retry, permanent
  failure, and duplicate queue delivery.
- Add retention/audit tests for 90-day raw-history pruning, one-year audit
  retention policy, append-only behavior, before/after revisions, and cleanup
  health reporting.
- Add frontend behavior tests or browser-level tests for stale/error indicators,
  per-feed timestamps, manual refresh semantics, plan-scope inspection,
  filters, and notification review behavior.
- Use existing repository conventions: Node’s built-in test runner for REST API
  libraries and the project’s existing frontend test approach where available.
- Include a load/rate-limit verification against the configured Avail cadence
  before production readiness is declared.

## Out of Scope

- A second dedicated Avail polling stream.
- Rider alerts, public publishing, vehicle assignment changes, or automated
  dispatch decisions.
- Automatic service-plan activation or date-driven lifecycle transitions.
- Editing generated notification text before approval.
- Indefinite raw AVL/event-position retention.
- Treating inferred `O`/`I` direction as verified compass evidence.
- Retroactive crossings when plans, resources, or rules become active.
- Silent inference of missed crossings when no observation captured a state
  transition.
- A new role hierarchy or mandatory separation of duties beyond existing
  authorization roles.
- A full event/schedule management product beyond the service-plan scope needed
  by Event Monitoring.

## Further Notes

- The current implementation has known gaps against this spec: the event poll
  gate still wraps the shared AVL poll, the live-map query currently joins
  active service plans, the detector uses a fixed three-minute window, and
  active-plan resource-link edits are not fully guarded. These are
  implementation discrepancies to resolve, not reasons to weaken the approved
  domain model.
- The current UI polls every 30 seconds, but that is a presentation refresh
  interval, not an upstream freshness guarantee.
- A vehicle may be visible during setup without being event-participating. This
  distinction should appear in API diagnostics and operator copy.
- The prior domain decisions are captured in [CONTEXT.md](../CONTEXT.md) and
  [ADR 0001](../docs/adr/0001-decouple-event-and-general-avl-cadence.md).
