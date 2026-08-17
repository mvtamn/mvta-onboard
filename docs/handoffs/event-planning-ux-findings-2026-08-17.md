# Handoff — Event Planning UX findings ready for implementation

**Written:** 2026-08-17
**Audience:** Codex (or any agent) picking up Event Planning UX work
**Source:** `/impeccable critique` dual-agent run, snapshot at
`.impeccable/critique/2026-08-17T05-16-44Z__kages-onboard-console-src-routes-eventplanning-tsx.md`
(scored 20/40; trend 24 → 18 → 26 → 20)

## State when this was written

Branch `event-plan-lifecycle` at `fe9ca60`. The console package typechecks
clean (0 errors) and the frontend suite passes (57 tests, 11 files).

`fe9ca60` already landed three fixes — do not redo them:

- The activation checklist renders from `draft` onward instead of only at
  `approved`.
- `Scope resources` carries `id="scope-resources"`, and the "complete the
  checklist" next action targets it instead of `planned-operating-resources`
  (which sits on *Plan details*).
- `@mvta/shared` was rebuilt. Its `dist` had drifted behind `src`, so the
  console was typechecking against declarations missing `route_conflict`,
  `EventServicePlanRevision.links`, and the `conflict_override_reason`
  argument. **If `tsc` reports those three as missing again, the fix is
  `npm run build` in `frontend/packages/shared`, not editing the types.**

## DO NOT TOUCH — owned by concurrent work

Seven tickets in `.scratch/event-plan-lifecycle/issues/` own the correctness
and architecture axis. Anything below overlapping them will collide:

| Ticket | Owns |
|---|---|
| 01 | Suspended plan's next action (currently contradicts its own banner) |
| 02 | Atomic scope publication across activation, revision apply, modify |
| 03 | Server-authoritative readiness; **removes `route_conflict` outright** |
| 04 | Event Plan lifecycle module (transition legality, editability, stage) |
| 05 | Shared plan-to-revision resource copy |
| 06 | Stage and next-action as server-supplied codes |
| 07 | ADR recording the server-authoritative decision |

In particular: **do not restructure readiness, stage derivation, or the
next-action ternary chains.** Ticket 03 and 06 rewrite exactly that code.

## DO NOT BUILD — undecided design questions

These came out of the critique but are **not decided**, and an agent that
picks them up will invent an answer. They need a human decision first:

- Whether Event Planning is one page or four routes (three of four workspace
  stages currently resolve to the same `/events/planning` URL).
- Whether geographic/map selection belongs in Planning at all.
- What the Event AVL handoff is, and whether scope can be rehearsed before
  activation.
- How a recurring Event reuses a previous period's scope.

Context if someone resumes that thread: five of the six variants in
`prototypes/event-planning-ui.html` and `prototypes/event-planning-ui-prototype.html`
are single-page; exactly one is a wizard. None of the six contains a map, a
preview affordance, or any duplicate/template language.

## Ready to build

Ordered by impact. Each is independent of the others and of the ticket list
above.

### 1. The Admin round trip destroys workspace context (P1)

Redesign-spec story 9 requires opening administration for a missing resource
"and return to Planning afterward … without losing my planning context."
Three separate defects break it:

- `EventPlanning.tsx:196` builds
  `/admin/events?geofence=${id}#event-configuration` — it carries `geofence`
  but **drops `event` and `plan`**. `EventWorkspaceContext` reads selection
  only from those params, so arriving in Admin clears the workspace.
- Because selection is now empty, `AdminModules.tsx:19`
  (`{selection.eventId ? <EventWorkspaceNav … /> : null}`) skips rendering the
  nav entirely — deleting the only return affordance.
- The `#event-configuration` hash is inert. React Router does not scroll to
  hashes and nothing implements it; the only `location.hash` reference in the
  app is `App.tsx:107`, inside `CompatibilityRedirect`.

**Acceptance:**
- [ ] The readiness href carries the full workspace suffix (`event`, `plan`,
      `revision`), built the same way as `EventWorkspaceNav.tsx:21-25`
- [ ] `EventWorkspaceNav` renders in Event Administration unconditionally,
      with an explicit "Return to Event Planning" action
- [ ] Arriving with `?geofence=` scrolls to and focuses the relevant geofence,
      either via a hash handler on route change or directly in
      `EventResourceMapEditor`
- [ ] Console version incremented, CHANGELOG entry added

### 2. Finish the "Event Plan" rename (P1)

The rename is half-applied and the project owner has confirmed **"Event Plan"
is now canonical**. Today three names for one entity appear on one screen:
"Event Plan" (400, 413, 485), "operating period" (407, 410, 424, 450), and
"Service Plan" (401).

- Every `id` and `aria-label` still says `operating-period`, so an input whose
  accessible name is "Operating period name" sits under a heading reading
  "Event Plan details". That breaks voice control outright ("click Event Plan
  name" matches nothing).
- The `complete` button reads **"Expire Event Plan"** while the lifecycle pill
  it advances flips to **"Completed"** (`statusLabels`, line 21). *Expired* is
  also already taken — `CONTEXT.md` uses it for notifications.
- Line 450 improvises "Bus messages" for what `CONTEXT.md` calls an
  operational notification.

**Acceptance:**
- [ ] Root `CONTEXT.md` makes "Event Plan" the canonical term and records
      "operating period" as superseded
- [ ] `operating-period-*` ids and aria-labels renamed; visible and accessible
      names agree
- [ ] "Service Plan" retained only where the immutable published artifact is
      genuinely meant
- [ ] Button verb and status label agree (either "Complete Event Plan" +
      "Completed", or "Expire" + "Expired" — not one of each)
- [ ] "Bus messages" replaced with the canonical term
- [ ] All statuses render through `displayStatus`, including the `planStatus`
      passed at line 353
- [ ] Console version incremented, CHANGELOG entry added

### 3. Styled-looking containers with no styles (P2)

Verified by grepping `styles.css`: `.event-review-evidence`,
`.event-conflict-override`, and `.event-geofence-roles` have **zero rules**.
Conversely `.event-empty-state` and `.event-planning-empty-actions` are fully
styled with **zero consumers**.

Consequence: the pre-activation summary — the one reassurance moment before
scope goes live — renders as a run-on line of bare inline `<span>`s, and lists
counts rather than names. And a console with no Events shows a dropdown
containing only "Select Event", while a designed empty state sits unused.

**Acceptance:**
- [ ] `.event-review-evidence` gets a label/value layout and lists resource
      **names**, not just counts
- [ ] `.event-conflict-override` styled or removed; its `<input>` gets
      `className="f"` like every sibling field
- [ ] `.event-empty-state` wired into the `events.length === 0` branch with a
      "Create your first Event" action
- [ ] The four `event-button-*` variants consolidated toward DESIGN.md's
      primary/secondary vocabulary
- [ ] Console version incremented, CHANGELOG entry added

### 4. Accessibility and robustness defects (P2)

Independent, small, each verifiable by test:

- [ ] **Focus race.** `focusResource` (≈224-227) schedules
      `requestAnimationFrame(() => document.getElementById(
      \`event-${kind}-select\`)?.focus())` *before* React commits
      `setResourceFocus`. Only one such id exists at a time, so when the
      callback wins the race `getElementById` returns null, `?.` swallows it,
      and focus silently never moves. Reachable via "Manage routes" while
      focus is on geofences.
- [ ] **Resource cards convey selection by CSS class only** — no
      `aria-pressed` / `aria-selected` / `role="tab"`. Announce the panel
      change too; today focus is yanked into a search input with no
      announcement.
- [ ] **"Review & activate" is a `<div className="panel-header">`**, so
      heading navigation runs `h2` → `h3`×3 → nothing and the most
      consequential section is unreachable by heading.
- [ ] **Every "Remove" button shares one accessible name** — add per-item
      context from the adjacent `link.label`.
- [ ] **One `resourceSearch` state serves all three resource tabs**, so a term
      typed for routes persists into geofences and yields "No matching
      geofences."
- [ ] **`linkMany` calls `clearSelection()` before firing requests**, so a
      failed link cannot be retried; it also reports "2 failed" without naming
      which two.
- [ ] **Duplicate Event prefills the identical name**, producing two Events
      indistinguishable in a picker that shows only names.
- [ ] **Operational messaging is not refetched when the plan selection
      changes** (only on mount and after mutations), so the panel can assert
      "Internal delivery: Off" for a plan whose Teams delivery is on.
- [ ] Console version incremented, CHANGELOG entry added

## Environment notes

- Typecheck: `npx tsc --noEmit -p .` from inside
  `frontend/packages/onboard-console`. The workspace-root `tsc -b --noEmit`
  fails on a pre-existing unrelated composite-project error.
- Tests: `npm run test` from `frontend/`, or
  `npm run test --workspace @mvta/onboard-console`.
- **Bump `frontend/packages/onboard-console/package.json` and add a
  `CHANGELOG.md` entry with every user-facing change** — standing project
  convention.
- Domain vocabulary is canonical in root `CONTEXT.md` and `docs/adr/`. Do not
  improvise synonyms; see item 2 above for the one term currently in flight.
- The app cannot be verified in a browser headlessly — Microsoft SSO plus
  Azure Maps tokens. Verify by test, not by screenshot.
- A concurrent agent session has been rebasing this branch. Check
  `git log --oneline -3` before starting and rebase rather than assuming the
  tip is where you left it.
