---
target: frontend/packages/onboard-console
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-11T17-18-02Z
slug: frontend-packages-onboard-console
---
⚠️ DEGRADED: single-context (no sub-agent or browser-control tool exposed)

# Event Workspace Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Stage, loading, retry, and configuration focus states are visible; readiness is still partly inferred. |
| 2 | Match System / Real World | 3/4 | The Plan → Configure → Activate → Monitor model fits OCC operations. |
| 3 | User Control and Freedom | 3/4 | Context persists and deep links now focus correctly; resource changes still require indirect navigation. |
| 4 | Consistency and Standards | 3/4 | Planning and AVL share the workspace stage model; Admin remains a different page composition. |
| 5 | Error Prevention | 3/4 | Bounded inputs and readiness checks help, but server-side conflicts are not previewed. |
| 6 | Recognition Rather Than Recall | 3/4 | Stage descriptions and reusable-resource guidance help; the full live scope is not summarized. |
| 7 | Flexibility and Efficiency | 2/4 | Resource linking remains one item at a time without search or bulk selection. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Duplicate navigation is gone and the configuration anchor is purposeful. |
| 9 | Error Recovery | 3/4 | Planning and AVL have retry actions; mutation failures remain generic. |
| 10 | Help and Documentation | 3/4 | Copy explains the main flow and revision consequence, but activation rules need authoritative detail. |
| **Total** | | **29/40** | **Stable improvement; remaining gaps are operational-data gaps more than layout gaps.** |

## Design Specificity Verdict

The Event Workspace now has a recognizable MVTA operational structure rather than a loose set of admin screens. The stage rail, reusable-resource explanation, active-plan language, retry states, and focused Admin deep link all reinforce the calm control-room direction.

The remaining limitation is that the UI still presents an inferred workflow. The stage rail says what the stages are, but the user cannot yet see a single authoritative readiness contract or a compact representation of the exact pinned scope being monitored.

### Deterministic scan

The scoped layout detector returned no findings for Admin, Event Planning, Event AVL, workspace navigation, or their relevant styles. The broader console detector continues to report existing accent-border patterns in unrelated modules; those are outside this Event Workspace critique.

Browser visualization was unavailable, so no live overlay or viewport-specific finding is claimed.

## Overall Impression

The previous critique scored 22/40, then 29/40 after the first layout and hardening passes. This pass preserves that improvement and closes the Admin anchor issue. The next meaningful gains require connecting the UI to the same authoritative operational model that activation and AVL use.

## What's Working

1. The stage rail is now the single navigation model and avoids duplicate links.
2. The Admin Event Configuration anchor scrolls to a grouped, focusable section and explains pinned-resource behavior.
3. Planning and AVL both provide visible recovery paths for load/feed failures.

## Priority Issues

### [P1] Readiness is still inferred locally

The checklist can appear complete while the server rejects activation because of conflicts, stale revisions, or authoritative scope rules.

Fix: add a server-backed readiness response with blocking reasons, warnings, and direct correction links. Use it in Planning and AVL.

Suggested command: `/impeccable harden frontend/packages/onboard-console`

### [P1] The exact active operating scope is still not visible as one object

Routes, geofences, locations, rules, assignments, and revision state remain distributed across tables and screens. A supervisor cannot quickly answer what is live.

Fix: add a Live operating scope summary with route names, geofence/rule coverage, location categories, revision status, and last applied time. Reuse it above the AVL map.

Suggested command: `/impeccable distill frontend/packages/onboard-console`

### [P2] Resource authoring is still one level removed from planning

The Configure stage now lands correctly, but users still leave the selected plan to inspect or maintain resources, then return to link them.

Fix: provide a contextual resource preview or drawer from Planning while preserving Admin as the owner of reusable resources.

Suggested command: `/impeccable clarify frontend/packages/onboard-console`

### [P2] Resource linking will not scale for large events

Repeated select-and-add controls are workable for a few resources but inefficient for a plan with many routes, stations, venues, and geofences.

Fix: add searchable resource pickers and multi-select or a reviewable “scope changes” list.

Suggested command: `/impeccable optimize frontend/packages/onboard-console`

## Persona Red Flags

### Alex — OCC power user

The navigation is now efficient, but adding many resources still requires repeated actions. The live scope summary is still missing during incidents.

### Jordan — first-time planner

The stage rail explains the sequence, and Admin now explains pinned resources. However, activation rules still become fully clear only after backend validation.

### Morgan — live operations supervisor

The AVL feed can be retried and scoped by plan, but the supervisor still has to infer whether the map, filters, and notifications represent the same complete service scope.

## Minor Observations

- The active stage can show Activate before server-backed readiness confirms activation is possible.
- Mutation errors such as failed linking or revision application should identify the object and next recovery step.
- The focused Admin section is accessible through the hash, but preserving the selected Event and plan name visibly there would improve continuity further.
- The stage markers should expose completion meaning to assistive technology beyond the visual checkmark.

## Questions to Consider

- Should the next slice prioritize the server-backed readiness contract or the Live operating scope summary?
- Should the scope summary lead Event AVL above the map, or remain a compact rail beside the map controls?
- For large events, is search enough, or is multi-select resource linking required?
