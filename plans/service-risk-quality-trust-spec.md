# Service Risk & Quality: truthful monitoring health, Watch conditions, and interventions

## Problem Statement

Service Operations staff need to determine whether fixed-route and on-demand
service is currently at risk. Today, an empty On-Demand response can appear as
Live data and “No on-demand wait risks” even when the source is not connected
or is stale. The application-wide “Live data connected” indicator measures
other services, not Service Risk & Quality. Fixed Route can also report zero
Service risks while calling ordinary monitored routes “affected.”

Staff need truthful, service-specific trust states, early but distinct Watch
conditions, reliable human-reviewed interventions, and Training scenarios that
never impersonate live operations.

## Solution

Service Risk & Quality will expose service-specific monitoring diagnostics and
display them locally. Fixed Route will distinguish monitored, Watch, and
affected service. On-Demand will remain Not connected until its approved
source completes an activation gate; once active, hourly authoritative
reconciliation establishes Current, No active service, or Degraded state.

Live Service risks remain threshold breaches only. Training scenarios are
explicitly non-operational. On-Demand interventions are persisted and
deduplicated, but every rider communication remains human-reviewed.

## User Stories

1. As an OCC viewer, I want each service view to state its own monitoring health, so that a healthy alerts feed cannot be mistaken for healthy risk monitoring.
2. As an OCC viewer, I want an unapproved On-Demand source to say Not connected, so that I do not treat an empty response as an all-clear.
3. As an OCC viewer, I want a successful reconciliation with zero active requests to say No active service, so that I understand why there are no current On-Demand records.
4. As an OCC viewer, I want degraded On-Demand data to remain visible with its freshness, so that I can use last-known evidence without treating it as current.
5. As an OCC viewer, I want authentication failure to be distinguishable from an unavailable source, so that I know whether to sign in or escalate a feed problem.
6. As an OCC viewer, I want Fixed Route data to become stale after three missed five-minute polls, so that old departure predictions are not treated as current.
7. As an OCC viewer, I want On-Demand data to become degraded after 90 minutes without authoritative reconciliation, so that webhook traffic cannot mask a stale source.
8. As an OCC viewer, I want current Fixed Route forecasts from 10 through 15 minutes to appear as Watch conditions, so that I can intervene before a Service risk occurs.
9. As an OCC viewer, I want an On-Demand predicted wait above 20 minutes through its standard to appear as a Watch condition, so that I can monitor it without confusing it for poor service.
10. As an OCC viewer, I want an overdue On-Demand request below its standard to appear separately from a projected Watch, so that I understand whether the condition is observed or forecast.
11. As an OCC viewer, I want Service risks to retain the existing thresholds, so that operational reporting is not weakened merely to populate a screen.
12. As an OCC viewer, I want Fixed Route metrics to distinguish routes monitored, Watch conditions, routes affected, and missing predictions, so that the summary is not contradictory.
13. As an OCC viewer, I want unknown capacity, assignment, and confidence to display as Unknown, so that missing vendor facts are not misread as zero capacity or low certainty.
14. As an OCC viewer, I want a Projected risk to appear immediately, so that an early warning is visible before a sustained breach is proven.
15. As an OCC publisher, I want a Projected risk to create one internal Suggested Alert only after two consecutive authoritative updates, so that one uncertain estimate does not create unnecessary review work.
16. As an OCC publisher, I want a Standard-exceeded or Critical On-Demand request to create or reuse one internal Suggested Alert immediately, so that an observed breach receives prompt review.
17. As an OCC publisher, I want recovered projected risks retained as resolved internal evidence, so that review history is not silently erased.
18. As an OCC publisher, I want to explicitly resolve an open Service-quality intervention, so that operational ownership is durable when no terminal source event is available.
19. As an OCC viewer, I want to acknowledge or monitor an intervention without resolving it, so that observation does not alter the operational record.
20. As an OCC user, I want a degraded service view to preserve last-known records but disable alert preparation and intervention actions, so that untrustworthy evidence cannot cause a new operational action.
21. As an OCC user, I want degradation in one service view not to disable the other service’s current workflow, so that a local source failure does not block all service operations.
22. As an OCC viewer, I want Training scenarios for both services, so that I can rehearse the workflow when real risk is absent.
23. As an OCC viewer, I want Training scenarios to be visibly non-live, so that I do not mistake them for operational data.
24. As an OCC viewer, I want Training actions to remain local previews, so that practice cannot create data, alert drafts, or rider messages.
25. As a service owner, I want an explicit On-Demand activation gate, so that Live data is enabled only after the approved source, non-PII mapping, active zones, webhook, reconciliation, and controlled breach-to-draft flow are verified.
26. As a compliance reviewer, I want On-Demand intervention state to use source-safe updates and retained evidence, so that retries, recovery, and later review remain explainable.
27. As a rider, I want every risk-originated customer communication to remain human-reviewed, so that an operational signal never sends a message automatically.

## Implementation Decisions

- Respect ADR 0026 and the Service Risk & Quality glossary: Watch conditions are not Service risks, Training scenarios are not Live data, and a Degraded feed is not a healthy empty response.
- Keep the existing Fixed Route threshold: predicted departure delay must be more than 15 minutes to become a Service risk. Define Fixed Route Watch as 10 through 15 minutes inclusive.
- Keep the applicable On-Demand Service standard as the poor-service threshold. Define On-Demand Watch as predicted total wait above 20 minutes through its standard, or an overdue request below its standard.
- Extend the existing On-Demand risk read contract with diagnostics containing the monitoring state, last successful authoritative reconciliation, latest source update, active-request count, and the applicable freshness thresholds.
- Establish On-Demand monitoring health from a dedicated authoritative reconciliation record. Webhook, vehicle, and duty activity are supporting evidence and cannot establish Current state.
- Use an explicit release setting to hold On-Demand in Not connected until the activation gate is verified. A successful empty reconciliation, not an empty risk table, establishes No active service.
- Implement a dedicated hourly, non-PII On-Demand reconciliation path. It may reuse the existing bounded source client and normalizer, but it is independent of missed-trip activation and policy.
- Retain the existing low-latency webhook as a hint, subject to source-state precedence; reconciliation remains authoritative.
- Render workspace-local states in this order: Loading, Authentication required, Not connected, Degraded, No active service, and Current. Only Current can make a No risks claim.
- Refresh the On-Demand workspace every 30 seconds while open. Preserve source freshness separately from browser refresh timing.
- Replace the app-shell risk-health claim with per-workspace health indicators.
- Calculate Fixed Route routes affected only from threshold-risk records. Show routes monitored and Watch conditions as separate metrics, and preserve missing predictions as data-quality context.
- Preserve last-known records read-only in a degraded state. Disable only the affected service’s alert-preparation and intervention actions.
- Persist one open Service-quality intervention per request. A Projected risk is visible immediately and prepares a Suggested Alert after two consecutive authoritative updates; observed Standard-exceeded and Critical requests prepare or reuse one immediately.
- Preserve recovered projected risks as resolved internal evidence. Pickup, cancellation, rescheduling, authorized resolution, and projected-risk recovery close an intervention according to its state.
- Allow publishers and administrators to resolve interventions; viewers may acknowledge and monitor without resolving.
- Expose null source facts as Unknown; do not manufacture a numeric capacity, assignment, or confidence value.
- Reuse existing sample scenarios only behind an explicit Training entry point. Training must not invoke write-capable API operations.
- Add no dependency, customer-data store, learned prediction model, or auto-publication path.

## Testing Decisions

The primary seam is the existing Service Risk & Quality API boundary: test each
workspace from its risk-response contract and diagnostics, rather than adding
a new client abstraction. HTTP handler tests establish contract and freshness
behavior; workspace tests verify the resulting operator-visible state and
enabled actions. Shared threshold helpers remain the focused seam for boundary
classification.

- Test every On-Demand diagnostic state, including the difference between a
  current zero-active reconciliation and an empty unconfigured/degraded source.
- Test the 90-minute authoritative-reconciliation boundary and confirm that
  webhook or duty activity alone cannot make the source Current.
- Test Fixed Route’s 10-, 15-, and greater-than-15-minute boundaries and
  On-Demand Watch/Service-risk boundaries against the applicable standard.
- Test the existing Fixed Route stale window after three missed five-minute
  polls.
- Test KPI output as operator-visible values: monitored routes, Watch
  conditions, affected routes, and missing predictions must not conflate.
- Test null capacity, assignment, and confidence as Unknown in the workspace.
- Test Projected-risk persistence, observed-breach immediacy, deduplication,
  recovery evidence, terminal closure, and role-limited explicit resolution.
- Test that a degraded source preserves records but disables only that source’s
  actions.
- Test Training scenarios through visible behavior and assert that they make
  no write-capable API call.
- Follow the repository’s existing focused shared-helper, function-handler,
  and React workspace tests; do not add a new test framework.

## Out of Scope

- Changing the 15-minute Fixed Route or applicable On-Demand poor-service threshold.
- Treating a public or local sample as a live operational risk.
- Declaring the current Spare integration approved or operational before the activation gate is complete.
- Retaining rider PII, raw vendor payloads, or pickup addresses.
- Automatic rider messaging or publication.
- New predictive models, a new dependency, or a new customer-data store.
- Broader Event, OTP, missed-trip, or dispatch redesign.

## Further Notes

The current public Fixed Route snapshot reviewed during discovery had no
greater-than-15-minute forecast. That is not a defect: real risk must not be
fabricated. A 10-minute forecast should become a Watch once this work ships.

On-Demand Live data may be enabled only after the agreed activation gate is
completed and recorded. Until then, Not connected is the correct operational
claim.
