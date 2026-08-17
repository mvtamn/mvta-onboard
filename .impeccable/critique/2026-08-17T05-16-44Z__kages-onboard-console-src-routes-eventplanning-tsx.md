---
target: frontend/packages/onboard-console/src/routes/EventPlanning.tsx
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-17T05-16-44Z
slug: kages-onboard-console-src-routes-eventplanning-tsx
---
Method: dual-agent (A: design review, isolated · B: detector + evidence, isolated)

**Target state:** `codex/prototype-detour-intake-ui` @ `7745ba5`, `EventPlanning.tsx` 506 lines (sha1 `26102a61`). The tree switched from `main` to this branch mid-run; both assessments were reconciled against the post-switch state. Browser visualization skipped — the app is gated behind Microsoft SSO and Azure Maps tokens, so this is static source analysis with no rendered evidence.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `periodDirty` (208) is computed but never rendered — unsaved edits are invisible until a confirm dialog ambushes you; raw lowercase `draft`/`active` leak at 409 while `displayStatus` (23) is used once |
| 2 | Match System / Real World | 2 | Three names for one object on one screen: "Event Plan" (400/413/485), "operating period" (407/410/424/450), "Service Plan" (401) |
| 3 | User Control and Freedom | 1 | No undo on unlink; no `beforeunload`, so refresh discards the edits the in-app confirm protects; readiness deep link (196) drops `event`/`plan`, destroying workspace context with no return path |
| 4 | Consistency and Standards | 2 | Three verbs for one behavior — "Manage routes"/"Add geofence"/"Add location" (429/432/435) all call `focusResource`; "Open selector" (445) opens nothing; two buttons save the same thing (413, 419) |
| 5 | Error Prevention | 2 | Duplicate Event (387) prefills the identical name with no suffix into a picker showing only names; `clearSelection()` runs before the link requests (267), so failed selections can't be retried |
| 6 | Recognition Rather Than Recall | 2 | One `resourceSearch` state (111) serves all three resource tabs — a term typed for routes persists into geofences and yields "No matching geofences." |
| 7 | Flexibility and Efficiency | 1 | "Duplicate this Event" copies name/team/description and **none of the scope** — no period copy, no resource copy |
| 8 | Aesthetic and Minimalist Design | 2 | The same three counts print three times (429-435, 448, 466) plus a fourth in the gate (457); four concurrent live regions |
| 9 | Error Recovery | 2 | `linkMany` reports "2 failed" (277) without naming which two; `.event-review-evidence` has no CSS, so the pre-activation summary renders as a run-on line |
| 10 | Help and Documentation | 4 | Genuinely strong — `panel-desc` copy is domain-literate, and 460 correctly distinguishes internal Event AVL from rider-facing publication |
| **Total** | | **20/40** | **Acceptable (lower edge) — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment: generic admin CRUD with transit words pasted on.** Strip the strings and this is a two-column entity editor — search + `<select>` for the parent record, `<select>` + name + four datetime inputs for the child, a three-tab checkbox multi-select for join-table rows, status pills, `window.confirm` on transitions. Swap "geofence" for "tag" and "operating period" for "campaign flight" and the file compiles unchanged.

The specific indictment: **this surface is about space and time, and it renders neither.** A planner assembling a State Fair shuttle is choosing polygons on a map and a window in a day. They get a 180px-max-height scrolling checkbox list (`styles.css:387`) and four disconnected date/time boxes. The Azure Maps renderer already exists one route away in `EventResourceMapEditor.tsx`; the destination, Event AVL, is a map. Planning is the only surface in the Event triad with no geography. The spec's core concept of sequential operating periods under one Event (redesign-spec story 4) is a `<select>` — a three-day Event's periods can never be seen side by side, so overlap, gaps, and sequencing are invisible.

**Deterministic scan:** 0 findings across `EventPlanning.tsx`, `EventWorkspaceNav.tsx`, `AdminModules.tsx`, `EventResourceMapEditor.tsx` (exit 0). This is a real clean result, not a broken harness — a canary with `cubic-bezier(0.68,-0.55,0.265,1.55)` correctly produced `bounce-easing`. **But zero findings here means "nothing detectable in this file's style surface", not "the UI is clean":** the file has almost no inline styling, and all visual decisions live in `styles.css`, which the detector isn't given.

**DESIGN.md resolution defect — confirmed and characterized.** `findDesignRoot()` in `detector/design-system.mjs` walks up from the target and stops at the first project marker (`.git`, `package.json`, `.impeccable`). It halts at `frontend/packages/onboard-console/`, so the real `DESIGN.md` two levels up is never found, and every design-system rule is silently inactive for this whole package. There is no CLI escape hatch. Assessment B obtained a corrected result set by invoking `detectText`/`loadDesignSystemForCwd` programmatically with the real root DESIGN.md: **still 0 findings on all four files**, with a canary proving the rules genuinely activate in that configuration. So the defect is real and will suppress findings package-wide, but for these four files the broken and corrected runs agree.

**Visual overlays:** none. No user-visible overlay is available — SSO gate, per above.

## Overall Impression

The page shows everything at all times, and the one thing that would let you stop scrolling is hidden. That sentence is the whole critique.

Cognitive load fails **7 of 8** checks (critical band), with **6 decision points exceeding 4 visible options**. But the mechanical root of the user's reported complaint is narrower and fixable: the most prominent control on the page is a scroll button, and the activation checklist renders only once it's already satisfied.

The single biggest opportunity: make the Next-action card *contain* the next step instead of pointing at it.

## What's Working

1. **The `suspended` modeling decision (9-14, 471-482).** Refusing to render `suspended` as a sixth lifecycle pill — because the backend has no forward transition out of it, verified against `eventServicePlans.ts` — and instead showing it as `active`-completed plus a callout. Most teams map enum values 1:1 to UI and imply a path that doesn't exist. This one didn't.
2. **Scoped feedback (31-37, 112-114).** Four independent `FeedbackScope`s rendered next to the panel that caused them, `role="alert"` for errors and `role="status"` for success. On a page this tall, a single top banner would scroll out of view.
3. **Session-expiry branching (117-121, 359-364).** Distinguishing 401 from generic failure and offering "Sign in again" instead of a "Try again" that would re-fire and fail identically — reasoned explicitly against OCC shift changes.
4. **`EventDateTimeField` (66-86) and the labeled Event search (376-380).** Real `<fieldset>`/`<legend>`, per-input `aria-label` and `aria-invalid`, a real `<label htmlFor>`, and help text that states its own scope ("it does not search Event Plan names"). Recent, correct, better than the rest of the file.

## Priority Issues

### [P0] The primary button scrolls, and the readiness checklist is hidden exactly when it's needed

**Why it matters:** This *is* the reported complaint, and it's two lines of code. `focusNextPlanningAction` (345-350) is `scrollIntoView({ behavior: "smooth" })` + focus — so in every state except `active`, the page's most prominent, evergreen, `btn-primary`-styled control is a viewport transport. Press it four times across a setup and you have been *moved* four times and *progressed* zero times. Compounding it, `.event-readiness` (484) is gated behind `nextAction === "advance"`, i.e. only at `approved` — so during `draft`, the longest phase, the user sees "4 of 6 readiness checks complete" (457) with no list, no item names, and no repair links. The deep link to the misconfigured geofence (196) exists but is unreachable until the problem it solves no longer exists.

Worse, the scroll target is wrong. The next-action for a missing resource targets `planned-operating-resources` (335), but that id sits on the section headed **"Plan details"** (372) — the Event picker and dates. The "Scope resources" section (422), which actually holds routes/geofences/locations, has no id at all. So the one action that says "add the missing operational resource" scrolls you to the wrong column. Both assessments found this independently.

**Fix:** Render the full `readiness` list with its `href` deep links from `draft` onward, unconditionally, beside the activation gate. Then make the Next-action card *contain* the active step's controls rather than pointing at them — when the next action is "Geofence linked", render the geofence picker inside the card, and collapse the other sections to one-line summaries behind a disclosure. If a navigation aid must remain, demote it to a text link and stop styling a scroll as `btn-primary`. Move the id to the correct section as a stopgap.

**Suggested command:** `/impeccable distill frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P0] The console package does not typecheck — `@mvta/shared` dist is stale

**Why it matters:** `npx tsc --noEmit -p .` reports **13 errors in `EventPlanning.tsx`** (and many more across `Admin.tsx`, `DetourIntake.tsx`, `Detours.tsx` from the Detour work on this branch). Root cause, verified: the console typechecks against `shared/dist`, not `shared/src`. `shared/src/types.ts` (Aug 17 00:04) declares `route_conflict?: boolean` and `EventServicePlanRevision.links`; `shared/dist/types.d.ts` (Aug 16 22:42) — built 82 minutes earlier — declares neither, and `dist/api.d.ts` still carries the 2-argument `transitionEventServicePlan`.

**This correction matters for severity.** Assessment A read the same 13 errors and concluded the conflict check was permanently green, the override UI dead code, and the readiness list "manufacturing confidence" for the exact failure mode that drives live operations. That diagnosis is wrong: the field exists in source, the REST layer populates it (`eventServicePlans.ts:80`, from `readinessByPlan`, defaulting to `false`), and `api.ts:788` does accept `conflict_override_reason`. **At runtime the conflict check works and the override input renders.** The defect is build-time only — but it's still P0, because the package doesn't compile, the `noImplicitAny` cascade (7 of the 13 errors) is pure noise hiding real ones, and any CI gate on `tsc` is currently red.

**Fix:** Rebuild `@mvta/shared` (or fix the project-reference/watch setup so `dist` can't drift behind `src`). Re-run the typecheck and confirm `EventPlanning.tsx` goes to zero. Then decide whether a stale-dist guard belongs in the pre-commit hook — this class of error will recur every time a shared type lands without a rebuild.

**Suggested command:** `/impeccable harden frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P1] The Admin round trip destroys the workspace, and the stepper is not telling the truth

**Why it matters:** Redesign-spec story 9 is explicit — open the administrative workflow for a missing resource "and return to Planning afterward … without losing my planning context." The implementation loses it. The readiness deep link (196) is `/admin/events?geofence=${id}#event-configuration`: it carries `geofence` and **drops `event` and `plan`**. `EventWorkspaceContext` reads selection only from those params, so arriving in Admin clears it — which makes `AdminModules.tsx:19` skip rendering `EventWorkspaceNav` entirely, deleting the only return affordance. The `#event-configuration` hash is inert; React Router doesn't scroll to hashes and nothing implements it. The user lands in a 185-line map editor not knowing which geofence needed the rule, with no way back but the browser button — after which their unsaved period name and dates are gone too.

Separately the stepper lies in three ways: `activeStage` (321-329) marks **Configure** active whenever the plan is a draft, telling the user they're in Admin authoring while they stand in Planning; **Monitor was removed** from the stages, so the journey now terminates at Activate, one step before the destination; and three of the four stages (`Plan`, `Review`, `Activate`) point at the identical href `/events/planning`, so clicking "Review" navigates to the page you're already on and nothing happens. That reads as a broken app.

**Fix:** Append the full workspace suffix to the readiness href, using the same construction as `EventWorkspaceNav.tsx:21-25`. Render `EventWorkspaceNav` in Admin unconditionally with an explicit "Return to Event Planning" action. Implement hash scroll on route change, or scroll/focus `#event-configuration` from `EventResourceMapEditor` when `?geofence=` is present. Fix the stage map so `draft`→Plan, `review`→Review, `approved`→Activate, `active`→a real terminal state, Configure active only on `/admin/*`, and either give the three planning stages distinct in-page targets or stop rendering them as separate destinations.

**Suggested command:** `/impeccable harden frontend/packages/onboard-console/src/components/EventWorkspaceNav.tsx`

### [P1] Finish the "Event Plan" rename — three names for one object, and a verb that contradicts its own pill

**Why it matters:** "Event Plan" (400/413/485), "operating period" (407/410/424/450/470/482), and "Service Plan" (401) all name one entity, all on one screen — and the copy at 401 defines the new term in terms of the old two. Every `id` and `aria-label` still says `operating-period`, so the accessible name and the visible name disagree: an input labelled `aria-label="Operating period name"` sits under a heading reading "Event Plan details", which breaks voice control ("click Event Plan name") outright. Worse, the `complete` button reads **"Expire Event Plan"** with matching confirm and feedback copy, while the lifecycle pill it advances flips to **"Completed"** (`statusLabels`, 21) — and *expired* is already taken in this domain, where CONTEXT.md defines "Expired operational notification" as something else. Line 450 improvises "Bus messages" for what CONTEXT calls an operational notification.

OCC staff hand off across shifts using this vocabulary verbally and in Teams. A console that calls one record three names, and whose button verb contradicts the state label it produces, cannot be quoted accurately.

**Fix (reflecting the decision that "Event Plan" is now canon):** Finish the rename rather than revert it. Update root `CONTEXT.md` to make "Event Plan" the ubiquitous term with "operating period" recorded as its superseded synonym, then sweep the UI: rename the `operating-period-*` ids and aria-labels, retire "Service Plan" from user-facing copy except where the immutable published artifact is genuinely meant, replace "Bus messages" with the canonical term, and either rename the button to "Complete Event Plan" to match the pill or rename the pill to "Expired" to match the button. Route every status through `displayStatus` (23), including the `planStatus` passed at 353.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P2] Styled-looking containers with no styles; a designed empty state that was never wired up

**Why it matters:** `.event-review-evidence` (462), `.event-conflict-override` (484), and `.event-geofence-roles` (450) have **zero rules** in `styles.css` — verified. The review-evidence block is five bare inline `<span>`s inside a `subcard`, so the single reassurance moment before scope goes live renders as one wrapped run-on paragraph, and it lists counts rather than names — you approve "3 routes · 2 geofences" without seeing which. The override `<input>` lacks `className="f"`, rendering unstyled beside fields that aren't. Conversely `.event-empty-state` and `.event-planning-empty-actions` are **fully styled with zero consumers** — a designed first-run empty state exists in CSS and was never wired up, which is why a zero-Events console shows a dropdown containing only "Select Event". Four new button variants (`event-button-primary/secondary/quiet/expire`) now exist beyond DESIGN.md's two-button vocabulary.

**Fix:** Give `.event-review-evidence` a label/value grid and list resource *names*. Style or delete `.event-conflict-override`. Wire `.event-empty-state` into the `events.length === 0` branch with a "Create your first Event" action. Consolidate the four button variants back toward DESIGN.md's primary/secondary.

**Suggested command:** `/impeccable polish frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

## Persona Red Flags

**Alex (power user, tenth recurring shuttle):** "Duplicate this Event" copies name, team, description — **no operating period, no resource links**. He re-links the same 3 routes, 2 geofences, 2 locations by checkbox every single time; there is no "copy scope from previous period" anywhere in the file. Duplicate prefills the *identical* name, so he creates a second "State Fair Shuttle" that is forever indistinguishable in a picker showing only names. One shared `resourceSearch` (111) means typing "Fair" for routes and then clicking "Add geofence" yields "No matching geofences." — a dead state he didn't cause. Minimum path to link one geofence is four interactions inside a 180px scroll region nested in an already-scrolling page.

**Jordan (first-time OCC admin):** Lands on an empty console — a `<select>` with one option and a primary button that scroll-animates to it; the designed empty state exists in CSS and doesn't render. Two competing step models on one screen (4-stage workspace nav, 5-state lifecycle `<ol>`), neither mapping onto the other, both using `aria-current="step"`. Clicks "Review" in the stepper: same URL, nothing happens. Lives longest in `draft`, where she's told "4 of 6 complete" and cannot see which two. "Open selector" (445) does nothing observable, and "Add geofence" doesn't let her create one.

**Sam (screen reader / keyboard):** "Review & activate" (458) is a `<div className="panel-header">` — heading navigation runs `h2`→`h3`×3→nothing, so the most consequential section is unreachable by heading and has no landmark. The resource type switcher is a de-facto tablist of three `<div>`s whose selection is conveyed by the `.selected` class alone — no `aria-pressed`, `aria-selected`, or `role="tab"`. `focusResource` (224-227) yanks focus into a search input on the next animation frame with no announcement of what changed; Sam hears "Search geofences, edit" with no idea the panel switched. Assessment B additionally flagged a **real race here**: the `requestAnimationFrame` is scheduled before React commits `setResourceFocus`, so if the callback runs first the old id is still in the DOM, `getElementById` returns null, and `?.` silently swallows it — focus never moves. Every "Remove" button (449) has the identical accessible name with no per-item context. The `aria-label` carrying ✓/! meaning (484) sits on a bare `<span>` with no role, which many AT implementations ignore.

**Riley (stress tester):** Refresh mid-flow — selection survives in the URL, but `planName`/`startDate`/`endDate` are local state and `periodDirty` guards only in-app switches, so refresh silently discards exactly what the confirm dialog protects. `getEventOperationalMessaging` runs on mount and after mutations but **not** when the plan selection changes, so line 461 can assert "Internal delivery: Off · eligible notifications remain queued" for a plan whose Teams auto-delivery is actually on. `counts.routes` counts `links` while the picker filters to `SpecialEvent && is_active`, so a route reclassified after linking still satisfies "Active SpecialEvent route linked". `linkMany` calls `clearSelection()` before firing the requests, so failed selections are gone and can't be retried. `.event-linked-resource span` doesn't truncate, so a long geofence name pushes its Remove button out of the row.

## Minor Observations

- Lines 413 and 419 call the identical `savePlanDetails` six rows apart with different labels and different button variants.
- Line 297 sends `conflictOverrideReason` on *every* transition including `submit-review`, not just `advance`.
- "1 locations linked" (448) — `counts.locations` gets no singular/plural treatment though 429 and 435 do.
- Line 465's `new Date(plan.end_at ?? plan.start_at)` renders an unset end as start–start, unlike 418 which correctly says "time not configured".
- Line 357 links to `/event-monitoring?…`, a `CompatibilityRedirect`; query params survive but the canonical path is `/events/avl`, which the app's own stepper already uses.
- `/events/planning` is `OCC.Admin`-only while `/events/avl` admits `OCC.EventAVL` — an Event AVL operator following a colleague's planning link hits a role wall with no explanation of who to ask.
- `visibleEvents` (165-168) searches team and description, but the option text (384) shows only `row.name`, so matches on team or description look like non-matches.
- `EventWorkspaceNav.tsx:32` calls `scrollIntoView` on mount unconditionally, scrolling the page on arrival before the user has acted.
- `.event-configuration-section` and its `:focus` outline are dead — no consumer.
- The detector's `hasRounded` flag came back `undefined` despite DESIGN.md declaring a `rounded:` scale, though `design-system-radius` still fires. Low confidence, not chased.

## Questions to Consider

1. **Why is there no map on the surface where geofences are chosen?** The renderer exists one route away, the destination is a map, the resources are polygons. What is the argument for a checkbox list other than that it was easier to build?
2. **If the stepper now ends at "Activate", where did Monitor go?** Removing it didn't make the handoff less abrupt — it removed the only thing framing it as a transition.
3. **Should Planning be one page at all?** Every failure above is a symptom of four objects on one scroll, and the nav already implies four destinations — three of which resolve to the same URL. What if Plan / Configure / Review / Activate were four routes with four focused views, and the nav told the truth?
4. **"Duplicate this Event" copies the label and none of the work.** For the tenth State Fair shuttle, what is the intended path — and if the answer is "re-link everything by hand", what is the button for?
5. **What would have caught the stale-dist typecheck failure before it reached a critique?** It's invisible to the detector, invisible in the browser, and only surfaces on a command nobody runs by reflex.
