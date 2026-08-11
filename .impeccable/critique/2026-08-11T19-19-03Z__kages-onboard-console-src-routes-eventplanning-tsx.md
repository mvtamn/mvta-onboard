---
target: Event Planning module, UI and UX
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-11T19-19-03Z
slug: kages-onboard-console-src-routes-eventplanning-tsx
---
# Event Planning Surface Critique

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | One `message` state (fed by 7 different actions across 4 panels) always renders in Panel 1 ([EventPlanning.tsx:171](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L171)), so a resource linked at the bottom of the page confirms/fails off-screen at the top, and success/error share identical `muted` styling. |
| 2 | Match System / Real World | 3/4 | Real OCC vocabulary ("Event AVL," "operating period," "reusable resources") but jargon is sometimes defined with more jargon. |
| 3 | User Control and Freedom | 1/4 | `transition("advance")` ("Activate for Event AVL"), `transition("suspend")`, and `revise("apply")` fire immediately on a single click with **zero confirmation** — even though `window.confirm` is already used one file away for lower-stakes actions ([EventResourceMapEditor.tsx:91](frontend/packages/onboard-console/src/routes/EventResourceMapEditor.tsx#L91)). There's also no way to unlink a mistakenly-added resource. |
| 4 | Consistency and Standards | 2/4 | The in-page lifecycle stepper reinvents the stage-marker pattern with inline hardcoded `#ccd6d1` and no ARIA ([EventPlanning.tsx:214](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L214)), instead of reusing `EventWorkspaceNav`'s accessible `aria-current="step"` pattern one component away. |
| 5 | Error Prevention | 2/4 | Live date-range validation is solid, but there's no dedupe guard before linking (the same route/geofence can be added twice) and no confirmation gate on the three highest-consequence actions noted above. |
| 6 | Recognition Rather Than Recall | 3/4 | The activation readiness checklist and "Current operating period" recap keep state visible without forcing recall. |
| 7 | Flexibility and Efficiency | 1/4 | Events are a flat, unsorted `<select>` with no search/typeahead ([EventPlanning.tsx:173](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L173)); no duplicate/template flow for recurring events; resource linking is one item at a time with no multi-select. |
| 8 | Aesthetic and Minimalist Design | 1/4 | Confirmed functional text as small as 9–10.5px (`.event-workspace-stages small`, `.event-workspace-kicker` — [styles.css:183,193](frontend/packages/onboard-console/src/styles.css#L183)), and all four workflow panels stay mounted and visible regardless of what state the plan is in. |
| 9 | Error Recovery | 2/4 | `loadError` retry is genuinely good (`role="alert"` + retry button), but action-level failures fall back to generic strings landing in the same mislocated banner as #1. |
| 10 | Help and Documentation | 1/4 | No tooltips, glossary, or doc links anywhere; the readiness item "Every linked geofence has a direction rule" gives no path to where that's actually fixed (a different route, `EventResourceMapEditor.tsx`). |
| **Total** | | **18/40** | **Acceptable→Poor. Strong domain modeling undermined by an unguarded high-stakes action, a real theming bug, and no progressive disclosure.** |

## Design Specificity Verdict

**LLM assessment:** This is authored for MVTA/OCC, not a generic CRUD template. Copy like "SpecialEvent route linked," "MVTA-local browser time," and "Admin maintains reusable resources; Planning assembles them into this Event's scope" reflects a real division of labor specific to this agency's event-response workflow, and the Plan → Configure → Activate → Monitor stage model is a bespoke operational concept, not an interchangeable SaaS pattern.

**Deterministic scan:** The bundled detector (`detect.mjs`) reported **clean (exit 0, no findings)** on the `.tsx` source of `EventPlanning.tsx`, `EventWorkspaceNav.tsx`, and `EventWorkspaceContext.tsx` — it's a markup-pattern scanner and doesn't reach into the CSS. The **live browser overlay** (injected on the running page) found **17 anti-patterns**, all real once cross-checked against source: 7× `undersized-ui-text` (9–10.5px functional text), 5× `ai-color-palette` ("cyan neon text on dark background" — likely the accent/pill colors read against the dark surface), 3× `tiny-text` (10.5–11px body text), 1× `cramped-padding` (4px horizontal padding for 12px text), and 1× `low-contrast` (1.9:1, needs 4.5:1 — text `#00553d` on background `#152219`).

That low-contrast finding traces to a **real bug, not just a taste call**: `.event-workspace-stages a:hover, .event-workspace-stages li.is-active a` sets `background: var(--success-bg)` at [styles.css:187](frontend/packages/onboard-console/src/styles.css#L187) — but `--success-bg` **is never defined** anywhere in `styles.css` or `eventMonitoring.css` (confirmed by grep across both files), in either the light or dark theme block. The background silently resolves to nothing, leaving `color: var(--brand-green)` (`#00553d`, a color explicitly designed in this codebase as a *fill* color — "Brand green stays constant across themes; it's a dark fill either way," per the comment at [styles.css:2-4](frontend/packages/onboard-console/src/styles.css#L2)) sitting directly on the dark surface as unbacked text. In dark mode that's dark-green-on-near-black at 1.9:1 contrast — the active/hovered workspace stage effectively disappears. The same undefined `--success-bg` variable is also used twice in `eventMonitoring.css` (lines 46, 63), so this isn't isolated to Event Planning.

## Overall Impression

The domain modeling is genuinely good — this reads like a tool built by people who understand OCC event operations, not a template. But the page behaves like an inferred workflow rather than a guided one: every panel is mounted at once regardless of what's actually next, the one feedback channel is bolted to the top of the page no matter which panel triggered it, and the three highest-consequence actions on the page — activating live monitoring, suspending it, and applying a revision to the active scope — get zero confirmation, even though the exact `window.confirm` pattern needed already exists one file away. Layered under that is a genuine, fixable CSS bug (an undefined `--success-bg` custom property) that makes the active workspace stage nearly invisible in dark mode. None of this requires a redesign; it requires closing gaps between patterns the codebase has already proven it knows how to build.

## What's Working

1. **Live, accessible date-range validation.** `periodError` is wired to `aria-invalid` and `aria-describedby` on both start/end inputs ([EventPlanning.tsx:193-194](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L193)), with a `role="alert"` message. Real accessibility care, not an afterthought.
2. **Activation readiness checklist.** The `readiness` array ([EventPlanning.tsx:87-93](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L87)) tells the user exactly why "Activate for Event AVL" is disabled instead of leaving them to guess — strong recognition-over-recall design.
3. **URL-persisted workspace context.** Event/plan/revision selection lives in the shared `EventWorkspaceContext`, so the stage nav carries state across Plan/Configure/Activate/Monitor with shareable, bookmarkable links — solid architectural consistency.

## Priority Issues

### [P0] Irreversible-in-effect actions have zero confirmation

**Why it matters:** `transition("advance")` ("Activate for Event AVL," publishes a scope live to riders), `transition("suspend")`, and `revise("apply")` all execute on a single click with no guard ([EventPlanning.tsx:216-218](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L216)). A misclick during a live event can publish or suspend real monitoring with no recovery step — and the codebase already proves it knows this pattern: `EventResourceMapEditor.tsx` uses `window.confirm` for the much lower-stakes act of deactivating a location ([EventResourceMapEditor.tsx:91](frontend/packages/onboard-console/src/routes/EventResourceMapEditor.tsx#L91)).

**Fix:** Gate these three actions behind a confirmation step with consequence-specific copy (minimum: `window.confirm`; better, given the stakes: a real modal that names what becomes live/paused).

**Suggested command:** `/impeccable harden frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P1] The active workspace stage is nearly invisible in dark mode — undefined CSS variable

**Why it matters:** `background: var(--success-bg)` at [styles.css:187](frontend/packages/onboard-console/src/styles.css#L187) references a custom property that is never defined anywhere in the stylesheet, so the hover/active fill silently drops out, leaving `--brand-green` text (a color built to be a *fill*, not a foreground) directly on the dark surface at 1.9:1 contrast — a hard WCAG AA fail (needs 4.5:1). The same undefined variable also affects two rules in `eventMonitoring.css`, so this is a shared token gap, not a one-off.

**Fix:** Define `--success-bg` in both theme blocks in `styles.css` (a light and dark tint of `--success-text`, matching the existing `--pill-success-bg` pattern), and audit the other two call sites in `eventMonitoring.css`.

**Suggested command:** `/impeccable harden frontend/packages/onboard-console`

### [P1] Feedback lands in the wrong place and doesn't distinguish success from failure

**Why it matters:** A single `message` state, set by 7 different actions across 4 panels, only ever renders inside Panel 1 ([EventPlanning.tsx:171](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L171)) with identical `muted` styling regardless of outcome. Link a geofence at the bottom of the page, and the confirmation (or error) appears off-screen at the top, indistinguishable from a success message at a glance.

**Fix:** Render feedback next to the control that triggered it, or use a toast; style success and error distinctly (color + icon, not just text).

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P1] No progressive disclosure — every panel is mounted regardless of state

**Why it matters:** Choose-Event, Define-Period, Lifecycle, and Resources are all visible at once even though the page's own guidance says "Start by choosing an Event, then define its operating period" ([EventPlanning.tsx:159](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L159)). Panel 2's period name/date fields are fully interactive before an Event is even chosen — only the submit button is disabled. This front-loads cognitive load for exactly the first-time users who need the least of it, and matches what the prior critique on this same file flagged as a blank/unfinished-looking canvas.

**Fix:** Visually collapse or hide the Lifecycle and Resources panels until a plan exists, and disable/dim (not just leave interactive) the period fields until an Event is selected — gate with layout, not just a disabled button.

**Suggested command:** `/impeccable onboard frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P2] Functional text is below the legibility floor in several places

**Why it matters:** `.event-workspace-stages small` renders at 9px and `.event-workspace-kicker` at 10px ([styles.css:183,193](frontend/packages/onboard-console/src/styles.css#L183)), both confirmed live at 9–10.5px on the rendered page (below an 11px floor for functional UI text), alongside 4px horizontal padding around 12px text. This is a legibility and accessibility issue, especially for the OCC operators who read this workspace nav constantly during live events.

**Fix:** Raise the stage-marker sub-label and kicker text to at least 11px, and increase padding around dense functional text to the ≥8px the detector flags as the floor for 12px text.

**Suggested command:** `/impeccable typeset frontend/packages/onboard-console`

## Persona Red Flags

### Alex — OCC power user, runs this every event season

- `#event-select` ([EventPlanning.tsx:173](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L173)) is a flat, unsorted `<select>` of Event names with no search and no active/completed grouping — a season's worth of events turns this into a scroll every single time.
- "Create another Event" just clears the form to blank; there's no duplicate/template-from-previous option for recurring events (e.g. a weekly game day), forcing full manual re-entry of name and dates each time.
- The three resource pickers (routes/geofences/locations) are one-select-one-click each with no multi-select — tedious for an event needing ten-plus geofences.
- At `status === "active"`, "Complete operating period," "Prepare revision," and "Suspend operations" render as identical `btn-sm` buttons side by side ([EventPlanning.tsx:217](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L217)) — wind-down, edit, and pause have very different consequences but look interchangeable, which is exactly where an experienced user moving fast mis-clicks.

### Jordan — first-time event planner

- Sees Panel 2's period name/date inputs fully live and typeable even though the banner above says to select an Event first — nothing but a disabled submit button signals that step 1 isn't done.
- The readiness item "Every linked geofence has a direction rule" has no link or button to where that's actually configured (a separate Configure-stage screen, `EventResourceMapEditor.tsx`) — Jordan has to discover that on their own.
- Terminology ("operating period," "Service Plan," "revision," "scope") is explained circularly in helper copy with no glossary or doc link.

### Sam — screen-reader / keyboard-dependent user

- The readiness checklist renders literal `"✓"`/`"!"` glyphs with pass/fail conveyed mainly through CSS color (`.ready` / `.missing` at [styles.css:220-221](frontend/packages/onboard-console/src/styles.css#L220)) — color-only differentiation is a WCAG risk, and the missing-item color (`#8a2e2e`) isn't paired with a text label like "Missing:".
- The in-page lifecycle stepper has zero ARIA (`role`, `aria-current`) despite `EventWorkspaceNav` one component away doing this correctly with `aria-current="step"` ([EventWorkspaceNav.tsx:39](frontend/packages/onboard-console/src/components/EventWorkspaceNav.tsx#L39)).
- Quick-action buttons that call `document.getElementById(...)?.focus()` move focus with no live-region announcement of why — disorienting without sight to follow the jump.

## Minor Observations

- The `steps` array appends `suspended` after `active` in a strictly linear stepper, implying it's a forward step rather than a side-branch — semantically misleading for a state that's meant to be temporary/reversible.
- Two near-identical "get started" banners exist (`event-planning-start` and `event-planning-empty`) saying almost the same thing about choosing an Event/period — redundant scaffolding for one onboarding funnel.
- The route picker silently filters to `route_category === "SpecialEvent" && is_active` with no on-page note explaining why some routes never appear.
- There's no unlink/remove action for a mistakenly linked resource — `link()` only ever inserts, and the copy doesn't address how to correct a mistake before submitting for review.
- Confirmed via live responsive check: at 768px the operating-period "Ends" datetime input is visibly clipped and the page gets a genuine horizontal scrollbar (the stacking breakpoint is set at 760px, missing the common 768px tablet width). At 375px the app-shell sidebar renders permanently expanded with no collapse affordance, pushing all Event Planning content off-screen — a shell-level issue, not specific to this route, but one that makes this page unusable on a phone regardless of its own responsive CSS.
- `localInput`/`toUtc` timezone helpers ([EventPlanning.tsx:21-31](frontend/packages/onboard-console/src/routes/EventPlanning.tsx#L21)) are a genuinely solid, easy-to-get-wrong detail handled correctly.
- Full-stack limitation encountered during review: the running app's mock-auth panel (Admin/Publisher/Viewer/etc.) did not clear the 401s from `/api/events`, `/api/event-service-plans`, and related endpoints, so live-data states (an Event actually selected, an active plan, linked resources) could not be visually confirmed — this critique leans on source reading plus the empty/unauthenticated state for those parts. Worth a look if it's not expected dev behavior.

## Questions to Consider

- Should "Activate for Event AVL" and "Suspend operations" really carry the same visual weight as "Cancel new Event"?
- Is a flat `<select>` for Events viable long-term, or does it only work today because the dev dataset is small?
- Was the missing confirmation on suspend/activate/apply-revision a deliberate scope decision, or just missed given `window.confirm` already exists one file away?
- If there's no unlink action, is the resource-linking table meant to be append-only by design — and if so, should the page say that plainly instead of implying corrections happen "before submitting for review"?
