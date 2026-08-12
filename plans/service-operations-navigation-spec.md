# Service Operations Navigation and Communications Spec

## Problem Statement

The staff console currently presents Compose, Active Messages, Suggested Alerts, and OCC service-risk tools as separate navigation destinations. As messaging and monitoring coverage grows, staff must remember which screen owns each step of the same operational loop: detect a service condition, review it, prepare a Service Alert, publish it, and manage the resulting active communication.

The current labels also mix “message,” “alert,” and “notification.” This makes it harder to distinguish authored customer-facing content from review workflow and delivery behavior. Specialist areas such as Events, Detours, Compliance, and Performance Assessment have different roles and workflows and must remain unavailable to staff who are not authorized for them.

## Solution

Introduce a role-aware **Service Operations** navigation area for the common communications and service-monitoring workflow:

1. Overview
2. Compose
3. Suggested Alerts
4. Active Service Alerts
5. Service Risk & Quality
   - Fixed Route
   - On-Demand

Service Operations should be visible when the signed-in user can access at least one child feature. Inaccessible children are hidden. Compose remains a prominent action, while users without publisher permission see the capability boundary without receiving publish access.

Events, Detours, Compliance, and Performance Assessment remain separate top-level, role-gated areas. The navigation should communicate that monitoring coverage has expanded without implying that specialist workflows have been merged.

Use the following canonical terms in the UI:

- **Service Alert:** customer-facing communication about a current or expected transit service condition.
- **Suggested Alert:** a detected or drafted Service Alert awaiting authorized review.
- **Active Service Alert:** an approved Service Alert currently eligible for rider display or delivery.
- **Delivery channel:** a configured destination or audience; selection does not prove delivery.
- **Service Risk & Quality:** the combined monitoring workflow with Fixed Route and On-Demand views.

Display this note in the Service Operations overview/header:

> **Service Operations combines service-alert communications and operational monitoring as MVTA’s coverage expands. Use the tabs to compose alerts, review active communications, or investigate fixed-route and on-demand service risk.**

## User Stories

1. As an OCC staff member, I want to find communications and service monitoring under one Service Operations area, so that I can follow the operational workflow without remembering multiple navigation groupings.
2. As an OCC staff member, I want to see an Overview first, so that I can understand current work requiring attention before choosing a detailed workflow.
3. As an OCC staff member, I want the Overview to show Suggested Alerts needing review, so that I can act on detected conditions quickly.
4. As an OCC staff member, I want the Overview to show Active Service Alerts nearing expiration, so that rider communications do not lapse unintentionally.
5. As an OCC staff member, I want the Overview to show fixed-route risks requiring intervention, so that I can prioritize departure delays.
6. As an OCC staff member, I want the Overview to show on-demand waits above the service standard, so that I can prioritize customer-impacting wait risks.
7. As an OCC staff member, I want a prominent New service alert action, so that I can communicate an incident without navigating through monitoring screens.
8. As an OCC publisher, I want to open Compose from Service Operations, so that I can create a Service Alert from internal incident notes.
9. As an OCC publisher, I want Compose to distinguish internal notes from rider-facing copy, so that internal operational language is not accidentally exposed to riders.
10. As an OCC publisher, I want to review suggested rider-facing copy before posting, so that AI assistance does not bypass human judgment.
11. As an OCC publisher, I want to see category, severity, affected service, delivery channels, and expiration together, so that I can confirm the publication checklist before posting.
12. As an OCC publisher, I want to understand that a selected Delivery channel is not proof of delivery, so that I do not report intent as completed communication.
13. As an OCC viewer, I want to discover Compose and understand why I cannot publish, so that I know how to request the correct permission.
14. As an OCC viewer, I want to view Active Service Alerts when authorized, so that I can understand what riders may currently see.
15. As an OCC publisher, I want to find Active Service Alerts by text, route, category, severity, or channel, so that I can manage a busy alert list efficiently.
16. As an OCC publisher, I want Active Service Alerts sorted by nearest expiration, so that I can renew or review the most time-sensitive communications first.
17. As an OCC publisher, I want the active-alert action to be named Edit expiration when that is the only editable field, so that the action matches its actual behavior.
18. As an OCC publisher, I want to retract an Active Service Alert with an explicit impact confirmation, so that an immediate rider-facing change is deliberate.
19. As an OCC publisher, I want post-action confirmation identifying the Service Alert and next step, so that I know whether it was retracted, extended, or otherwise changed.
20. As an OCC staff member, I want to open Suggested Alerts from Service Operations, so that I can review detected risks before they become Active Service Alerts.
21. As an OCC staff member, I want to see the distinction between Suggested Alerts and Active Service Alerts, so that I do not confuse a review candidate with rider-visible communication.
22. As an OCC staff member, I want Service Risk & Quality to be one monitoring destination, so that the number of navigation items does not grow with every service type.
23. As an OCC staff member, I want Fixed Route and On-Demand as secondary views within Service Risk & Quality, so that the service-specific metrics remain clear without duplicating the parent workflow.
24. As an OCC staff member, I want Fixed Route risk to show predicted departure delay, threshold timing, confidence, evidence, and data freshness, so that I can decide whether intervention is warranted.
25. As an OCC staff member, I want On-Demand quality to show current wait, predicted total wait, service standard, assignment context, and accessibility impact, so that I can decide how to respond to customer wait risk.
26. As an OCC staff member, I want data-gap records separated from actionable service exceptions, so that missing data is investigated rather than treated as normal service or the same as a confirmed delay.
27. As an OCC staff member, I want live, stale, preview, and unavailable data states to be unmistakable, so that I do not act on sample data or stale observations.
28. As an OCC staff member, I want an alert-preparation action to return me to the originating risk context, so that I can verify what caused the Suggested Alert.
29. As an OCC staff member, I want acknowledgement and monitoring state to be shared across the shift, so that two operators do not maintain contradictory local views of the same risk.
30. As an OCC staff member, I want the Service Operations group to hide features I am not authorized to use, so that the navigation reflects my actual responsibilities.
31. As an Events-authorized staff member, I want Event Planning and Event AVL to remain separate from Service Operations, so that event-scope workflows retain their specialist context.
32. As a Detours-authorized staff member, I want Detours, Detour Intake, and Detour Reports to remain separate, so that detour lifecycle work is not confused with general Service Alert composition.
33. As a Compliance-authorized staff member, I want Compliance to remain separately role-gated, so that compliance investigation access can be granted independently.
34. As an assessment-authorized staff member, I want Performance Assessment to remain separately role-gated, so that contractual assessment workflows are not exposed to general OCC staff.
35. As an unauthorized staff member, I want restricted specialist areas hidden rather than shown as unusable links, so that I am not presented with capabilities outside my role.
36. As an OCC staff member, I want the expanded-coverage note to explain the navigation change, so that I understand why messaging and monitoring now share a workspace.
37. As an OCC staff member, I want the interface to remain usable at tablet width, so that essential operational fields and actions are not clipped.
38. As an OCC staff member, I want the terminology to consistently use Service Alert, Suggested Alert, Active Service Alert, and Delivery channel, so that each state and responsibility has one clear meaning.

## Implementation Decisions

- The highest implementation seam is the authenticated console shell and navigation model. Add Service Operations as the shared role-aware navigation boundary, then render the existing workflows inside it.
- Preserve the existing workflow components and API contracts where possible. This work is primarily information architecture, route composition, labels, and shared UI state; it should not rewrite message or risk-detection logic.
- Use one Service Operations Overview as the landing surface. It should compose permission-aware summaries and links to existing workflows rather than create a second source of operational truth.
- Keep Compose, Suggested Alerts, Active Service Alerts, and Service Risk & Quality as distinct child workflows. Do not combine their forms, tables, and risk details into one screen.
- Keep Fixed Route and On-Demand as secondary views within Service Risk & Quality.
- Keep Events, Detours, Compliance, and Performance Assessment as separate top-level role-gated areas.
- Show Service Operations when the user has access to at least one child feature; hide inaccessible children. Server-side authorization remains authoritative.
- Preserve the existing publisher/admin write boundary for Compose and Active Service Alerts. Viewer access must not gain publish, expiration-edit, or retract capability.
- Retain compatibility for existing deep links when changing display names or grouping routes. Existing paths may redirect or render the new shell, but saved links must not break.
- Use “Active Service Alerts” as the display label while preserving the underlying active-message behavior and data contract unless a separate migration is explicitly approved.
- Add a shared Service Operations note explaining expanded monitoring coverage.
- Add explicit Overview cards/actions only for features the current user can access.
- Preserve the human-review boundary: detection may prepare a Suggested Alert, but only authorized staff can approve and publish an Active Service Alert.
- Persisted acknowledgement, monitoring, ownership, search/filtering, undo, and audit improvements are follow-on work unless needed by the new shell to avoid misleading UI.
- Treat the existing accepted navigation-boundary ADR and domain glossary as authoritative for the role separation and terminology.

## Testing Decisions

- Test external behavior at the console shell boundary: visible navigation, hidden role-restricted children, route rendering, active labels, deep-link compatibility, and permission-gated actions.
- Test the Service Operations Overview with representative role combinations: viewer, publisher, admin, compliance-only, detour-only, and users with no Service Operations child access.
- Test that Compose remains discoverable but does not offer publishing to viewers.
- Test that Active Service Alerts exposes read-only behavior to viewers and edit/retract behavior only to authorized publishers/admins.
- Test that Fixed Route and On-Demand render as secondary views under Service Risk & Quality and preserve preview/live labeling.
- Test empty, loading, live, stale/error, preview, and permission states for the Overview and Service Risk & Quality entry point.
- Test that restricted Events, Detours, Compliance, and Performance Assessment links are not rendered for unauthorized roles and that direct navigation remains server/route protected.
- Test accessible keyboard navigation and selected-state announcements for the Service Operations switcher and Service Risk & Quality tabs.
- Use the existing React Testing Library/Vitest approach used by the console, with route-level behavior tests preferred over implementation-detail assertions.
- Preserve existing tests for Event Planning and extend the same role/route testing style to the new navigation shell.
- A good test verifies what a staff member sees and can do for a role and data state; it should not assert internal component structure, CSS class names, or private state shape.

## Out of Scope

- Rebuilding the message composition, Suggested Alerts, Active Service Alerts, Fixed Route Risk, or On-Demand Service Quality domain logic.
- Connecting the on-demand vendor adapter or changing the `MonitoredOnDemandWaits` contract.
- Changing fixed-route thresholds, prediction calculations, or risk ordering rules beyond presentation-level grouping.
- Persisting acknowledgement, monitoring, or ownership state.
- Implementing a new notification provider or making Teams delivery live.
- Adding event, detour, compliance, or performance-assessment workflows to Service Operations.
- Removing role enforcement from any existing route or API.
- Replacing the existing Dashboard with Service Operations Overview unless explicitly chosen as a later information-architecture migration.
- Renaming backend tables, API endpoints, or database fields solely to match the display terminology.

## Further Notes

- The Service Operations grouping is a navigation and mental-model consolidation, not a claim that all operational workflows share one domain model.
- The public-facing term is Service Alert. Notification remains a delivery concept, consistent with the domain glossary.
- The design should make expanded coverage visible without making restricted specialist capabilities visible to staff who cannot use them.
- The agreed UI note is: “Service Operations combines service-alert communications and operational monitoring as MVTA’s coverage expands. Use the tabs to compose alerts, review active communications, or investigate fixed-route and on-demand service risk.”
- Existing local preview behavior must remain clearly labeled and must never create records or send communications.
