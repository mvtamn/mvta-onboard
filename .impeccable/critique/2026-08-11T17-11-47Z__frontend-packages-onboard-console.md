---
target: frontend/packages/onboard-console
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-11T17-11-47Z
slug: frontend-packages-onboard-console
---
⚠️ DEGRADED: single-context (no sub-agent or browser-control tool exposed)

# Event Workspace Follow-up Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Stage rail, loading, retry, and AVL feed states are now visible; backend readiness remains incomplete. |
| 2 | Match System / Real World | 3/4 | Event workspace stages and operational terminology fit OCC work. |
| 3 | User Control and Freedom | 3/4 | Context is preserved and failed loads can be retried; resource editing remains indirect. |
| 4 | Consistency and Standards | 3/4 | Planning and AVL now share a stage model, though Admin still feels structurally separate. |
| 5 | Error Prevention | 3/4 | Bounded inputs and visible readiness help; server-side conflicts are not previewed. |
| 6 | Recognition Rather Than Recall | 3/4 | The stage rail improves orientation, but the live scope is still mostly a table of links. |
| 7 | Flexibility and Efficiency | 2/4 | Resources still require one-at-a-time selection and there is no search or bulk action. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Duplicate navigation was removed and the planning setup now has clearer grouping. |
| 9 | Error Recovery | 3/4 | Planning and AVL expose retry actions; action-level failures still use generic messages. |
| 10 | Help and Documentation | 3/4 | Stage descriptions and next-step copy help, but resource and activation consequences need more direct explanation. |
| **Total** | | **29/40** | **Meaningful improvement; scope visibility and server-backed readiness remain.** |

## Design Specificity Verdict

The Event Workspace now feels more authored for MVTA operations. The Plan → Configure → Activate → Monitor rail gives the domain a visible structure, and the language distinguishes operating periods, event service routes, reusable resources, active scope, and Event AVL.

The remaining weakness is not visual polish. It is that the interface still treats the operating scope as a collection of linked records. The user can understand the sequence, but cannot yet see the complete executable scope or trust the UI's readiness state as the same contract the API will enforce.

### Deterministic scan

The full console detector found six existing accent-border warnings in Decision Matrix, OTP, Service Risk, and shared console CSS. None are introduced by or specific to the Event Workspace changes. A scoped layout scan for Event Planning, Event AVL, workspace navigation, and related CSS returned no findings.

Browser visualization was unavailable, so no live overlay or viewport-specific claim is made.

## Overall Impression

The score improved from 22/40 to 29/40. The workspace now has a clearer reading order and fewer competing navigation choices. The next improvement should move from presentation to operational truth: make readiness and active scope first-class data, not inferred UI summaries.

## What's Working

1. The stage rail makes the lifecycle legible without adding a second navigation system.
2. Planning now has a clear setup region, lifecycle gate, and resource region.
3. Retry states and bounded inputs make the interface more resilient under real network and data conditions.

## Priority Issues

### [P1] Readiness is still inferred locally

The UI can display a ready-looking checklist while the backend may reject activation because of conflicts, stale revisions, or other authoritative rules.

Fix: expose a server-backed readiness response with blocking reasons, warnings, and direct correction links. Use it in Planning and the AVL no-scope state.

Suggested command: `/impeccable harden frontend/packages/onboard-console`

### [P1] The active operating scope is still hard to inspect

Routes, geofences, locations, rules, and assignments remain distributed across a table and separate screens. During an incident, the supervisor still has to reconstruct what is actually live.

Fix: add a compact Live operating scope summary with route names, geofence/rule coverage, location categories, revision status, and last applied time. Reuse it on AVL.

Suggested command: `/impeccable distill frontend/packages/onboard-console`

### [P2] Configuration remains a deep link into Admin rather than a contextual workspace step

The rail labels Configure correctly, but the Admin destination does not visibly carry the selected Event and plan into the resource-authoring context or explain whether edits affect the active plan.

Fix: show the workspace context and a pinned-resource explanation in the Event Configuration section; clearly distinguish reusable resource edits from plan revision edits.

Suggested command: `/impeccable clarify frontend/packages/onboard-console`

### [P2] Resource selection remains inefficient for large inventories

One select plus one button per route, geofence, and location does not scale for events with many managed resources.

Fix: add search, resource metadata, and multi-select or an add-to-scope list. Preserve one explicit review step before changes enter a revision.

Suggested command: `/impeccable optimize frontend/packages/onboard-console`

## Persona Red Flags

### Alex — OCC power user

The stage flow is faster to understand, but adding ten resources still means ten repeated selection actions. The live scope summary is still missing during incident response.

### Jordan — first-time planner

The stage labels help, but “Configure” still opens Admin without showing what is reusable versus what is pinned to this plan. Activation rules are still partly discovered by trial and error.

### Morgan — live operations supervisor

AVL now communicates feed failure and retry, but the supervisor cannot quickly verify that the map, route filters, and geofence notifications all represent the same complete operating scope.

## Minor Observations

- The stage rail uses numbered markers and checkmarks; ensure their meaning is also available to assistive technology, not only visually.
- The active Planning stage is based on plan status, so the rail can show Activate before all backend readiness checks have passed.
- The Admin anchor should focus the relevant Event Configuration section after navigation.
- Action failures such as linking a resource or applying a revision still need specific recovery copy.

## Questions to Consider

- Should the API readiness contract be the next implementation slice before further visual refinement?
- Should “Live operating scope” be the primary content block on Event AVL, above the map?
- For large events, is multi-select resource linking required, or is searchable one-at-a-time selection sufficient?
