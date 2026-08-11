---
target: frontend/packages/onboard-console
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-11T16-52-00Z
slug: frontend-packages-onboard-console
---
⚠️ DEGRADED: single-context (no sub-agent or browser-control tool exposed)

# Event Workspace UX Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | AVL has explicit feed states, but Planning and Configuration do not share a persistent readiness/status model. |
| 2 | Match System / Real World | 3/4 | Event, operating period, service plan, revision, and managed vehicle language fits OCC operations. |
| 3 | User Control and Freedom | 3/4 | Context can be changed and revisions cleared, but navigation away from Admin does not preserve a fully visible operational context. |
| 4 | Consistency and Standards | 2/4 | Event Planning uses generic stacked panels while AVL uses a specialized workspace; the shared bar is helpful but does not unify page structure. |
| 5 | Error Prevention | 2/4 | The activation checklist is useful, but backend conflicts and stale resource revisions are discovered only after submission. |
| 6 | Recognition Rather Than Recall | 2/4 | Users must remember which resources belong to the selected plan; links are listed as rows but not represented as one operational scope. |
| 7 | Flexibility and Efficiency | 2/4 | Routes, geofences, and locations are added one at a time, with no bulk selection, search, or keyboard-efficient workflow. |
| 8 | Aesthetic and Minimalist Design | 2/4 | The console is on-brand and restrained, but Event Planning is vertically long and repeats lifecycle, scope, and configuration concepts. |
| 9 | Error Recovery | 2/4 | Errors appear as text messages, but loading failures have no consistent retry action or field-level recovery path. |
| 10 | Help and Documentation | 2/4 | Descriptions explain concepts, but the interface does not teach the complete Plan → Configure → Activate → Monitor sequence at the point of use. |
| **Total** | | **22/40** | **Usable foundation; workflow cohesion remains the main gap.** |

## Design Specificity Verdict

### LLM assessment

The Event surface is authored for MVTA in its terminology and operational states, especially the Event AVL feed health, managed-service scope, revision language, and evergreen control-room palette. It is not category-interchangeable at the domain level.

Structurally, however, it still resembles a generic admin console: long stacked forms, panel headers, select controls, and tables. The biggest missed opportunity is to make the Event operating context the primary object of the experience. Planning currently feels like a form collection, Configuration feels like an Admin subsection, and AVL feels like a separate monitoring product. The new workspace bar connects them technically, but not yet cognitively.

### Deterministic scan

The scoped detector found one warning in `frontend/packages/onboard-console/src/styles.css:170`: a thick side-tab accent border. This belongs to the broader console styling and is not used by the Event Workspace components reviewed here, so it is a false positive for this surface. A broader scan also found similar accent-border patterns in Decision Matrix, OTP, and Service Risk modules; those are outside this critique's target.

Browser visualization was not available in this session, so no live overlay or viewport-specific finding is claimed.

## Overall Impression

The foundation is credible and the operational vocabulary is much stronger than a typical dashboard. The single biggest opportunity is to turn the three screens into one guided operating workspace: define an event, configure reusable resources, assemble and validate an executable service plan, activate it, then monitor that exact pinned scope. Today the user still has to mentally bridge those stages.

## What's Working

1. The Event Workspace context is a strong architectural move. Persisting Event, plan, and revision selection in the URL gives Planning and AVL a shared scope instead of isolated local selections.
2. Event AVL communicates live, unavailable, connecting, and healthy-with-no-vehicles states explicitly. That supports the product principle of distinguishing live data from unavailable data.
3. The Planning activation checklist makes hidden requirements visible and prevents an obviously incomplete plan from being activated.

## Priority Issues

### [P1] The workflow has navigation continuity but not task continuity

**Why it matters:** The user can navigate between Plan, Configure, and Event AVL, but the screen does not clearly say what stage they are in, what remains, or what action unlocks the next stage. Admin configuration is still conceptually detached from the selected operating plan.

**Fix:** Add a persistent four-stage stepper/status rail: Plan → Configure resources → Activate service plan → Monitor operations. Show the current stage, completion state, and one primary next action. Keep the selected Event and plan summary visible on Admin configuration as well as Planning and AVL.

**Suggested command:** `/impeccable layout frontend/packages/onboard-console`

### [P1] The activation checklist is not a complete readiness contract

**Why it matters:** The UI checks local resource data, while the backend also validates conflicts, date windows, pinned revisions, and operational constraints. A user can see “ready” and still receive a generic transition error.

**Fix:** Expose a server-backed readiness result with blocking reasons and warnings. Each failed item should link to the exact correction: add route, configure direction rule, resolve date overlap, or review revision. Use the same readiness result in Planning and the AVL empty state.

**Suggested command:** `/impeccable harden frontend/packages/onboard-console`

### [P1] Scope is represented as lists instead of an operational model

**Why it matters:** Multiple routes, locations, geofences, rules, and vehicle assignments are the core Event feature, yet users see rows of links rather than a concise scope summary. This makes it hard to answer “what exactly is live?” during an incident.

**Fix:** Add a “Live operating scope” summary card showing route count and names, geofence count and rule coverage, location count by category, assignment/revision state, and last published/applied time. On AVL, make this summary the source of the route/geofence/location filters.

**Suggested command:** `/impeccable distill frontend/packages/onboard-console`

### [P2] Resource authoring and resource selection are too disconnected

**Why it matters:** Configuration creates reusable map resources, while Planning selects them through plain dropdowns. Users cannot quickly inspect the polygon, station type, rule direction, or map location before linking it.

**Fix:** Use resource-picker rows or a split view: searchable resource list on the left, compact map/details preview on the right, with an explicit “Add to plan” action. Preserve the distinction between reusable Admin resources and plan-pinned versions.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console`

### [P2] Operational and administrative actions are still mixed in the mental model

**Why it matters:** Admin contains reusable resource maintenance and AVL settings, while Event Planning owns activation and Event AVL owns live response. The shared Configure link helps navigation but does not explain ownership or permissions.

**Fix:** Label configuration as “Reusable resources” and show a clear note: “Changes here affect future revisions; active plans remain pinned.” Put plan-specific configuration and readiness inside Event Planning, and reserve Admin for reusable assets and system settings.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console`

## Persona Red Flags

### Alex — OCC power user

- Adding several routes/geofences/locations requires repeated select-and-click cycles with no search or bulk action.
- The active scope is not summarized in one place, so incident response requires scanning multiple sections.
- Assignment approval creates a revision, but the next action is still a textual instruction rather than a direct “Review revision in Planning” action.

### Jordan — first-time event planner

- “Operating period,” “revision,” “SpecialEvent route,” and “managed vehicle” are meaningful internal terms but are not introduced as a simple sequence.
- The Admin Configuration link can feel like a different product area even though it is required to complete the event.
- A failed activation may be explained by an API error after the UI showed a local checklist; this undermines confidence.

### Morgan — live operations supervisor

- AVL correctly states when data is unavailable, but the screen does not prominently show the pinned scope details that determine which routes and geofences are being monitored.
- Diagnostic vehicles and managed vehicles are separated, but the operational consequence of proposing an assignment is easy to miss in a dense table.

## Minor Observations

- The Event Workspace bar uses a compact 11–12px treatment; on narrow screens it wraps, but the context could still be visually lost among the dense panels.
- “Configure” currently links into an Admin anchor; deep-linking should also focus or expand the relevant resource section and preserve the selected Event context visibly.
- Planning readiness uses text symbols (`✓`, `!`) without a stronger semantic label or icon alternative for assistive technology.
- Generic `message` paragraphs are doing several jobs: load error, success confirmation, and workflow guidance. Separate status, error, and next-action regions would improve scanability.
- The detector warning at `styles.css:170` should be handled in a broader console polish pass, not as part of this Event-specific work.

## Questions to Consider

- Should the Event Workspace stepper be the primary navigation for these screens, replacing the current loose Plan / Configure / Event AVL links?
- Do you want Event Planning to show a single “ready to activate” contract supplied by the API, even if that requires a new readiness endpoint?
- Should reusable resource maintenance remain in Admin but be launched as a contextual drawer/preview from Planning, or should the map authoring surface move fully into the Event Workspace?
- During live operations, should the AVL screen default to only the pinned service-plan scope and make diagnostics an explicit secondary view?
