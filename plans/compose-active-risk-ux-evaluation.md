# Compose, Active Messages, and Service-Risk UX Evaluation

**Updated:** August 11, 2026  
**Scope:** Staff console features for Compose, Active Messages, Fixed Route Service Risk, and On-Demand Service Quality.  
**Review basis:** As-built frontend behavior, API integration points, existing product rules, and the implementation handoff.

## Executive assessment

The four features form a coherent operational loop:

```text
Incident notes or detected risk → staff review → prepared customer message → approval/publish → active-message management
```

The strongest part of the current experience is the separation between operational detection and customer publication. Both service-risk screens explain why a record was flagged, distinguish preview data from live data, and route live detections into Suggested Alerts instead of publishing automatically.

The main usability gap is that the console still makes staff assemble context across separate screens. Compose has several important controls but weak guidance about what is required, what is suggested, and what will actually be delivered. Active Messages is a useful table but is too passive for an operational queue. The risk workspaces are visually consistent and information-rich, but their local-only acknowledgement/monitoring state does not yet support shared shift operations.

## Feature evaluation

### 1. Compose

**Purpose:** Create a rider-facing announcement from internal incident notes, with optional AI-assisted rider wording, classification, expiration, scope, and delivery channels.

**Current behavior**

- Requires internal incident notes.
- Allows a separate rider-facing summary, with a manual “Suggest rider-facing summary” action and an automatic draft after typing pauses.
- Supports category, severity, explicit expiration, category-default expiration, affected routes, internal tags, and channels.
- Includes MVTA Connect as a zone-based affected-service option alongside fixed routes.
- Includes a Teams routing option, but records the intended audience without sending a Teams post.
- Requires publisher/admin permission to post; the API remains the authoritative permission boundary.
- Resets the form after success and invokes the parent refresh callback.

**What works well**

- Internal notes and rider-facing copy are correctly separated, which reduces the risk of exposing operational language to riders.
- AI output is framed as a suggestion and can be edited before posting.
- Expiration defaults reduce an easy-to-miss operational failure mode.
- Route selection is sourced from the route registry when available and degrades to free text when it is not.
- The Teams connector limitation is disclosed before staff assumes delivery occurred.

**Current limitations / risks**

- The form description says OnBoard can suggest category, severity, and expiration, but the implementation currently suggests only rider-facing summary; category and severity remain manual.
- The auto-draft behavior is not obvious until it starts. A staff member may interpret a newly populated summary as an accidental overwrite, even though the effect intentionally avoids overwriting non-empty text.
- There is no character guidance, rider preview, or explicit indication of which fields are required for a publishable alert.
- Expiration has no visible timezone or minimum-time guidance. A stale or past value is not prevented at the form boundary.
- Channel checkboxes are presented as a flat list. Staff cannot quickly see the delivery plan, selected count, or whether a channel is unavailable/not connected.
- A successful post returns an ID and expiration in a status message, but does not offer a direct link to Active Messages or show the newly posted alert in context.
- If route/default configuration requests fail, the fallback is functional but not clearly surfaced as a degraded data source.

### 2. Active Messages

**Purpose:** Provide a current view of published alerts and allow authorized staff to extend expiration or retract an alert.

**Current behavior**

- Loads active messages into a table with summary, category, severity, routes, channels, expiration, and actions.
- Viewer roles can read; publisher/admin roles can edit expiration and retract.
- Expiration editing uses a per-row datetime input.
- Retraction uses a browser confirmation dialog and immediately removes the message from rider channels through the API.

**What works well**

- The table exposes the operational fields most needed for a quick scan.
- Role-based action visibility makes the read/write boundary understandable.
- Retract is deliberately confirmed because it has immediate rider impact.
- The empty state is concise and non-alarming when there are no active messages.

**Current limitations / risks**

- There is no search, filter, sort, or “last updated” indicator. During a busy incident, staff must scan the whole table.
- “Edit” means edit expiration only, but the label implies broader message editing.
- Long summaries, routes, and channel lists can make rows difficult to scan; there is no expandable detail or tooltip treatment.
- The table is not wrapped in a dedicated horizontal-scroll treatment in `MessagesTable`, so narrow screens are likely to clip or compress operational content.
- Retraction has no typed confirmation, reason capture, undo window, or prominent post-action result beyond a reload/error path.
- After editing or retracting, the list refreshes but there is no row-level progress state or confirmation identifying exactly what changed.
- Active messages do not link back to audit history, suggested-alert provenance, or the original raw incident notes.

### 3. Fixed Route Service Risk

**Purpose:** Surface fixed-route trips whose future departure is predicted to exceed the 15-minute threshold, ordered for intervention.

**Current behavior**

- Uses authenticated GTFS-Realtime TripUpdate-derived predictions when available.
- Shows predicted maximum departure delay, first threshold crossing, time to intervention, trend, confidence, reasons, vehicle context, and a stop-by-stop timeline.
- Preserves a Current Telemetry view for supporting realtime data.
- Refreshes on a selectable interval and continues refreshing through the console shell.
- Opens an existing Suggested Alert or creates a deduplicated pending draft for review.
- Falls back to clearly labeled preview scenarios when protected live data is unavailable.
- Includes missing prediction/data-gap records so absence of data is not treated as on-time service.

**What works well**

- The primary list is exception-first and pairs well with a selected detail pane.
- “Predicted” versus current delay is explicit, and the first threshold crossing is a useful intervention cue.
- Confidence and plain-language reasons make the prediction more explainable.
- The feed-status banner and preview label help prevent local mock data from being mistaken for live operations.
- The workflow correctly ends at alert preparation/review, not publication.

**Current limitations / risks**

- A missing prediction appears in the same exception list as actionable delay risk. It is counted separately, but the list needs a stronger distinction between “intervene” and “investigate data.”
- A countdown such as “9 min” is ambiguous without a fixed “threshold at” timestamp and timezone.
- The selected detail does not make the observation age prominent enough for a fast stale-data decision; it should show “updated X ago” and source freshness beside the headline metric.
- A stop-by-stop timeline is useful but can be dense under pressure; the first actionable threshold should be visually prioritized and accompanied by a simple “act by” cue.
- Acknowledge and Monitor are local UI state only. Two operators can see different workflow states, and a refresh clears the state.
- The “Prepare alert” action changes workflow and navigates away, but the originating risk context is not guaranteed to remain visible when staff returns.
- The telemetry view is nested behind the OCC Tools switcher and an internal toggle, increasing navigation cost for staff who need to compare risk with raw feed state.

### 4. On-Demand Service Quality

**Purpose:** Surface MVTA Connect trips with predicted or actual customer wait above the 25-minute service standard.

**Current behavior**

- Uses the vendor-neutral `MonitoredOnDemandWaits` contract when populated.
- Shows current wait, predicted total wait, predicted pickup, zone, assignment, stops ahead, accessibility requirement, eligible vehicles, trend, confidence, and evidence.
- Distinguishes predicted poor service from poor service already occurring.
- Shows a progress bar against the 25-minute standard.
- Prepares or opens a Suggested Alert for live records; preview records only show local customer wording.
- Uses a preview state when the on-demand producer is not connected.

**What works well**

- The 25-minute standard is visible at the point of use and repeated in the detail view.
- The distinction between actual elapsed wait and predicted total wait supports different intervention decisions.
- Assignment context and accessibility requirements expose operational causes, not just symptoms.
- The customer-update action is appropriately separated from automatic publication.
- The screen is intentionally vendor-neutral, reducing future integration lock-in.

**Current limitations / risks**

- “Current wait” and “predicted total wait” require a clear wait-start definition; the UI does not expose the timestamp or source freshness needed to assess that calculation.
- The progress bar saturates at 25 minutes, so a 27-minute actual wait and a 60-minute actual wait have the same visual fill. The numeric label helps, but severity is understated visually.
- “Stops ahead” is not explained for a demand-response trip and may be misunderstood as fixed-route stops.
- There is no zone-level summary of demand, capacity, or number of trips at risk beyond the list count and median wait.
- On-demand risk records are not grouped by service zone, vehicle constraint, or accessibility impact, which are likely the most useful dispatching lenses.
- Like Fixed Route Risk, Acknowledge and Monitor are local-only states.
- When live data is unavailable, preview scenarios remain useful for UI review but can create a false sense of readiness because the live producer is not yet connected.

## Cross-feature UX recommendations

Priorities below are ordered by operational risk and frequency of use.

### P0 — Make data state and action state durable

1. Persist acknowledgement, monitoring, and ownership as operational events with actor, timestamp, and reason. Show the shared state in every risk list and detail view.
2. Add a consistent freshness treatment: source status, last successful update, observation age, and stale threshold. Do not rely on a small banner alone.
3. Separate actionable exceptions from data-quality exceptions. For fixed route, use sections or filters for “Needs intervention” and “Data gap.”
4. Add a consistent post-action confirmation that names the record and next step, for example: “Alert draft prepared for Route 442 NB — review in Suggested Alerts.”

### P1 — Reduce decision time in Compose and Active Messages

1. Add a compact “Publish checklist” near the submit action: rider copy, category/severity, affected service, channels, and expiration.
2. Add a rider preview that shows the summary, affected service, severity treatment, and selected channels. Make AI provenance visible but secondary.
3. Rename Active Messages’ action to “Edit expiration” or expand editing to match the label. Add search, category/severity/channel filters, and default sort by nearest expiration.
4. Replace browser `confirm()` for retraction with an in-app confirmation panel containing the message, impact statement, required reason, and a short undo period if the backend supports it.
5. Link successful Compose posts and risk-prepared alerts directly to the resulting Active Message or Suggested Alert.

### P1 — Improve risk triage

1. Sort by urgency using a shared rule: actual breach first, then time to threshold, then predicted overage, then data gaps.
2. Make the primary metric consistent: “+18 min predicted at 4:42 PM” for fixed route and “31 min predicted total wait, 19 min elapsed” for on-demand.
3. Add explicit timestamps and timezone context to predicted pickup/departure and observation freshness.
4. Add filters for route/zone, worsening/recovering, assigned/unassigned, confidence, accessibility requirement, and prepared-alert state.
5. Preserve list selection and return context after navigating to Suggested Alerts.

### P2 — Improve resilience and accessibility

1. Make all list-row controls explicitly keyboard navigable with a visible focus state and a clear selected-state announcement.
2. Add responsive table behavior for Active Messages: horizontal scroll, sticky first column, or a compact card layout at narrow widths.
3. Replace color-only status cues with text and icons that remain understandable in high-contrast and color-vision conditions.
4. Add loading skeletons and row-level busy states instead of replacing large regions with generic “Loading…” text.
5. Surface degraded route/default configuration as a non-blocking warning so staff knows when the form is using fallback behavior.

## Suggested acceptance criteria for the next UX pass

- A staff member can tell within two seconds whether each screen is showing live, stale, preview, or unavailable data.
- A staff member can identify the next action for every risk without opening another screen: acknowledge, monitor, prepare a customer update, or investigate a data gap.
- A staff member can compose and preview the rider-facing message, see affected service and delivery channels, and confirm expiration before posting.
- A staff member can find an active message by route, category, severity, or text and can identify the nearest expiration without scanning every row.
- Acknowledge/Monitor state is shared across users and survives refresh/navigation.
- Preview mode cannot create a database record, send a notification, or look identical to live mode.
- The interface remains usable at tablet width without clipping core operational fields.
- All four workflows have automated coverage for loading, empty, stale/error, permission, live, and preview states.

## Implementation references

- Compose: `frontend/packages/onboard-console/src/components/ComposeForm.tsx`
- Active Messages: `frontend/packages/onboard-console/src/components/MessagesTable.tsx`
- Fixed Route Service Risk: `frontend/packages/onboard-console/src/routes/modules/FixedRouteServiceRisk.tsx`
- On-Demand Service Quality: `frontend/packages/onboard-console/src/routes/modules/OnDemandServiceQuality.tsx`
- Shared risk styling: `frontend/packages/onboard-console/src/routes/modules/serviceRisk.css`
- Operational rules and limitations: `MVTA_ONBOARD_MANUAL.md`, Sections 5–6
- Implementation handoff and API contract: `plans/FEATURE_IMPLEMENTATION_HANDOFF.md`

## Validation performed

- `npm test -- --run` from `frontend`: 1 test file, 23 tests passed.
- `npm run build` from `frontend`: shared package, rider app, and onboard console built successfully.
- Build emitted existing Vite chunk-size and dynamic-import warnings; no compile or test failures were observed.
