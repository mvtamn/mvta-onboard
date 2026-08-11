---
target: frontend/packages/onboard-console/src/routes/EventPlanning.tsx
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-11T17-29-37Z
slug: kages-onboard-console-src-routes-eventplanning-tsx
---
⚠️ DEGRADED: single-context (no sub-agent or browser-control tool exposed)

# Event Planning Surface Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | The selected Event is visible, but the no-operating-period state does not explain the immediate next action strongly enough. |
| 2 | Match System / Real World | 3/4 | Event identity and operating period are valid OCC concepts. |
| 3 | User Control and Freedom | 3/4 | Existing Events and periods can be selected, but create-new controls dominate the initial state. |
| 4 | Consistency and Standards | 3/4 | The workspace stage rail and panel treatment are consistent with the console. |
| 5 | Error Prevention | 2/4 | Create-period remains disabled without an explicit explanation of missing inputs or date validity. |
| 6 | Recognition Rather Than Recall | 2/4 | Users must infer whether to select an existing Event, create one, or select/create a period. |
| 7 | Flexibility and Efficiency | 2/4 | Existing Event planning and new Event creation share one dense form; there is no clear fast path for repeat events. |
| 8 | Aesthetic and Minimalist Design | 3/4 | The visual language is calm and coherent, but the initial state leaves a large empty work area. |
| 9 | Error Recovery | 2/4 | Load retry exists, but form and activation failures do not provide field-level correction. |
| 10 | Help and Documentation | 2/4 | Helper copy is accurate but long and does not clearly distinguish setup from the next decision. |
| **Total** | | **24/40** | **Strong visual foundation; initial-state hierarchy is the main weakness.** |

## Design Specificity Verdict

The page feels authored for MVTA: the evergreen panel system, Event Workspace rail, operating-period vocabulary, and Event AVL handoff all fit the product. The problem is task composition, not branding.

In the supplied screenshot, the user has an existing “State Fair” Event selected but no operating period selected. The page still gives “Create a new Event” nearly equal visual weight to the actual next task. The lower half then becomes empty because lifecycle and scope are conditionally hidden. This makes the page look unfinished rather than intentionally awaiting the next decision.

The scoped layout detector returned no findings. Browser automation was unavailable, so the critique uses the supplied screenshot plus source inspection rather than a live overlay.

## Overall Impression

The page is visually calm and structurally improved, but it does not yet behave like a focused planning workspace. For the shown state, the primary action should be obvious within one second: select or create an operating period for State Fair. Instead, the interface presents two competing setup modes and a large blank region.

## What’s Working

1. The Plan → Configure → Activate → Monitor rail gives the page a clear product-level position.
2. The two-column Event setup / Operating period layout is a sensible desktop structure.
3. The existing Event identity is confirmed beneath the selector, which reassures the user that “State Fair” is the active context.

## Priority Issues

### [P1] The initial state has no clear primary task

**Why it matters:** With State Fair selected and no period selected, the user must decide between creating an Event, selecting a period, or creating a period. The interface does not declare which action advances the workflow.

**Fix:** Add a compact “Next step” state beside the selected Event: “State Fair is selected. Create or select an operating period to continue.” Make the operating-period panel the primary emphasis and move new Event creation into a secondary “Create another Event” action.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P1] The blank lower page reads as a broken or incomplete screen

**Why it matters:** Lifecycle and resource sections are hidden until a plan exists, leaving a large empty canvas in the screenshot. Users receive no explicit explanation of what will appear next.

**Fix:** Replace the blank region with an intentional empty state: “No operating period selected” plus one primary action, “Create operating period,” and a secondary action, “Select existing period.” Once a period is selected, reveal lifecycle and scope sections.

**Suggested command:** `/impeccable onboard frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P2] New Event creation is over-weighted for an existing Event workflow

**Why it matters:** The screenshot shows State Fair already selected, yet the page allocates three inputs and a Create Event button to a secondary path. This increases cognitive load and makes the common repeat-event workflow feel administrative.

**Fix:** Collapse new Event creation behind “Create new Event,” or present it as a secondary inline action below the Event selector. Keep the selected Event and its operating periods as the dominant content.

**Suggested command:** `/impeccable distill frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P2] Operating-period inputs lack a clear label hierarchy and validation guidance

**Why it matters:** The native datetime controls are compressed in the narrow panel, and the disabled Create button does not explain that a name, start, and end are required or that the end must be later than the start.

**Fix:** Use visible field labels, stack the date fields predictably, add concise helper text, and show an inline validation message before submission. The primary button should read “Create operating period” only when the required inputs are complete.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

## Persona Red Flags

### Alex — OCC power user

The page spends valuable space on creating an Event even when an Event already exists. Selecting or creating an operating period requires scanning multiple controls instead of following one obvious next action.

### Jordan — first-time planner

The difference between Event, operating period, and service plan is explained in prose but not reinforced by the action hierarchy. The blank area below the setup panels provides no confidence about what happens next.

### Morgan — event operations lead

The page does not show whether State Fair has any existing periods until the selector is opened. A compact period summary or status count would reduce repeated inspection.

## Minor Observations

- “Event identity” is a useful label, but “Selected Event” would better match the selector’s role.
- “Operating period” and “Service Plan” are both used; the relationship should be stated once and consistently.
- The two panels have similar visual weight even though the operating period is the next required action.
- The screenshot’s large empty area would be a good place for a deliberate no-period state rather than whitespace.

## Questions to Consider

- For an existing Event, should creating a new Event be hidden behind a secondary action?
- Should the no-period state offer one primary Create action and one secondary Select action?
- Do planners need to see period status and date ranges directly in the selector or in a compact list beneath it?
