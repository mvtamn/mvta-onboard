# Service Risk & Quality trust implementation plan

## Goal

Make Fixed Route and On-Demand useful operational monitors without confusing an
empty, stale, unconfigured, or training response for current service risk.
The existing thresholds remain unchanged: Fixed Route risk is a predicted
departure delay of more than 15 minutes; On-Demand risk is a predicted or
observed wait above the applicable standard.

## Decisions already made

- A real risk is never fabricated to populate a live workspace.
- Training scenarios are visible to Service Risk viewers and have no database
  or external side effects.
- Fixed Route Watch is 10 through 15 predicted minutes inclusive.
- On-Demand Watch is a predicted wait above 20 through its standard, or an
  overdue request below its standard.
- On-Demand remains Not connected until the activation gate below is met.
- Fixed Route becomes stale after three missed five-minute polls; On-Demand
  becomes degraded after 90 minutes without successful hourly authoritative
  reconciliation.
- An observed On-Demand standard breach creates one internal, deduplicated
  Suggested Alert immediately. A projected breach is visible immediately but
  creates that draft only after two consecutive authoritative updates.
- A recovered projected risk is retained as resolved internal evidence.
- Publishers and administrators may resolve interventions; viewers may only
  acknowledge or monitor them.

The durable decision and glossary terms are in ADR 0026 and `CONTEXT.md`.

## Scope

### 1. Add an On-Demand monitoring health contract

Add an `OnDemandRiskDiagnostics` response alongside `risks` from
`GET /api/on-demand-risks`. It must report:

- `state`: `not_connected`, `current`, `no_active_service`, or `degraded`;
- the latest successful authoritative reconciliation;
- the latest source update and active-request count;
- the configured reconciliation and degradation thresholds.

Use a small monitoring-health record written only by the authoritative
reconciliation. Webhook, vehicle, and duty updates may provide supporting
timestamps but must not make a degraded source Current. Do not infer
`no_active_service` from an empty risk table; only a successful reconciliation
that reports zero active requests may establish it.

Use an explicit `ON_DEMAND_MONITORING_ENABLED` release setting. It is set only
after the activation gate passes, so an unconfigured endpoint always reports
`not_connected`.

### 2. Separate On-Demand reconciliation from Missed Trips

Create a dedicated hourly, non-PII reconciliation path for active On-Demand
requests. It may reuse bounded Spare client and normalization code, but it
must not be controlled by `SPARE_MISSED_TRIPS_ENABLED` or inherit missed-trip
policy. The existing webhook remains a low-latency hint; reconciliation is
the authority.

The reconciler writes:

- current active-request state and zone/policy snapshots;
- its health record, including a successful zero-active-request result;
- intervention progression and recovery evidence.

It does not retain rider names, contact data, addresses, or raw vendor
payloads.

### 3. Make the On-Demand workspace truthful and refreshable

Poll `GET /api/on-demand-risks` every 30 seconds while the workspace is open.
Render the diagnostic state before rendering any empty result:

| State | Operator-facing result | Actions |
| --- | --- | --- |
| Loading | Checking the protected monitor | Disabled |
| Authentication required | Sign in again | Disabled |
| Not connected | No source claim | Disabled |
| Degraded | Last-known records and freshness warning | Read-only |
| No active service | Latest reconciliation found no active requests | Disabled |
| Current | Current risks, watches, and no-risk state | Enabled by role |

Render nullable capacity, confidence, and assignment facts as `Unknown`, not
as zero or low confidence. Keep source facts and operator workflow state
visually distinct.

### 4. Correct Fixed Route metrics and protect stale actions

Keep the existing five-minute ingest and 15-minute stale window. In the
workspace:

- calculate `Routes affected` from threshold-risk records only;
- add separate `Watch conditions` and `Routes monitored` values;
- retain `Missing predictions` as data-quality context;
- disable live alert preparation while the fixed-route feed is stale, while
  retaining its last-known records read-only.

This removes the current contradiction where zero at-risk trips can coexist
with “Routes affected.”

### 5. Implement On-Demand intervention lifecycle

Use the existing one-open-intervention-per-request concept:

1. Show a Projected risk immediately.
2. On its second consecutive authoritative projected breach, create or reuse
   one pending Suggested Alert.
3. On an observed Standard-exceeded or Critical request, create or reuse one
   pending Suggested Alert immediately.
4. On recovery before review, retain the pending item as resolved evidence;
   never silently delete it or publish it.
5. Terminal pickup, cancellation, rescheduling, or authorized resolution
   closes the intervention.

This requires a small persisted intervention state and source-version-safe
updates; do not implement it as browser-local workflow state.

### 6. Add training scenarios

Add an explicit Training entry point in each service view. It uses the existing
sample scenarios but labels the mode prominently and permits only local
preview/acknowledge/monitor actions. It must not call live alert, intervention,
or message endpoints.

## Activation gate

Before setting `ON_DEMAND_MONITORING_ENABLED=true`, verify and record:

1. Approved source owner, contract, and credentials.
2. Confirmed non-PII field mapping and pickup-commitment semantics.
3. Loaded active operational zones.
4. Authenticated webhook delivery.
5. Successful hourly reconciliation, including a zero-active-request run.
6. A live controlled breach that creates one internal Suggested Alert and
   never sends a rider communication automatically.

## Tests

Add focused tests for:

- every On-Demand diagnostic state, including empty-but-current versus empty
  and not-connected/degraded;
- the 90-minute authoritative-reconciliation boundary;
- watch and risk boundaries for both service types;
- no false `0 vehicles` or `Low confidence` for null source facts;
- projected-risk persistence, observed-breach immediacy, recovery, deduping,
  and authorization to resolve;
- stale Fixed Route action disabling and corrected KPI calculations;
- Training scenarios making no API write.

## Acceptance criteria

- A healthy empty source says `No active service`, never `No risks` by
  assumption.
- A missing or stale On-Demand source cannot be marked Live data.
- A source-specific failure does not impair the other service type.
- A current fixed-route service with a 10-minute forecast is visible as Watch,
  not Service risk.
- Every live action remains human-reviewed; no code path auto-publishes a
  rider message.
- The app shell makes no broad “Live data connected” claim for risk monitoring.

## Deliberately deferred

- Changing either poor-service threshold.
- Claiming the current Spare integration is approved or live.
- Adding a new dependency, prediction model, or customer-data store.
