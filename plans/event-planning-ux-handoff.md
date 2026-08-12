# Handoff — Event Planning UX/accessibility/scaling pass

**Written:** 2026-08-12
**Audience:** Claude or another engineer continuing MVTA OnBoard's Event Planning workflow
**Scope:** `frontend/packages/onboard-console/src/routes/EventPlanning.tsx` and its immediate collaborators — `EventWorkspaceNav.tsx`, `EventWorkspaceContext.tsx`, `EventResourceMapEditor.tsx`

## Current state

**PR https://github.com/mvtamn/mvta-onboard/pull/19 is merged**. The branch
continued with follow-up commits `c2c7866` and `4916afe`, and the frontend
deployment workflow has published the current console build. The current
console version is `1.5.20`.

The follow-up work corrected the Event Planning order so planned resources
precede review and activation, then hardened Azure Maps layer teardown so
leaving Event AVL cannot blank the console.

The original issue #18 implementation was merged through PR #19 on
2026-08-12. Check `gh pr view 19 --repo mvtamn/mvta-onboard --json state,mergedAt`
only when auditing deployment history.

## How this got to its current state

Three critique-fix rounds, then a formal spec, then implementation — in that order:

1. **Round 1–3** (committed as `e6a58ff` and `836fac9`, on `main` already): confirmations on high-stakes lifecycle actions (activate/suspend/apply-revision), a dark-mode CSS contrast bug (`--success-bg` referenced but never defined), per-panel feedback instead of one shared banner, progressive disclosure on the operating-period form, mobile sidebar/topbar/stage-nav fixes, a dirty-check guard on the period selector, session-expiry recovery, and a restructure of the "Operating period lifecycle" panel (primary/secondary action separation, a `.subcard` for pending revisions, honest `suspended`-state handling since no backend transition exists back out of it). Full narrative in `CHANGELOG.md` entries `1.5.16`–`1.5.18`.
2. **Spec** (issue #18, labeled `ready-for-agent`): synthesized from the accumulated critique backlog via the `to-spec` skill. 20 user stories, explicit Implementation/Testing Decisions, explicit Out of Scope. One notable discovery baked into the spec: `unlinkEventServicePlan` and its backend endpoint already existed, fully authorized symmetric with linking — nobody had wired a "Remove" button to it. That reframed two "backend-sounding" items as frontend-only.
3. **Implementation** (commit `b54389e`, PR #19): all of issue #18's Implementation Decisions landed, TDD'd against a newly-introduced Vitest + React Testing Library harness (first frontend tests in this repo — `EventPlanning.test.tsx`, 23 tests). Two-axis `code-review` (Standards + Spec sub-agents) ran; one real finding (an unused `@vitest/ui` devDependency) got fixed before commit; one real, disclosed deviation did not (see below).

Read the PR description and issue #18 for the itemized "what" — not reproduced here.

## What's specifically still open

1. **Event picker pattern deviation (disclosed to the project owner, undecided).** Issue #18 named two options — native `<datalist>` or a small custom combobox. The shipped code kept the plain `<select id="event-select">` and added a separate search-input filter above it instead, to avoid `<datalist>`'s id/name-resolution ambiguity and to preserve the `id="event-select"` contract (`document.getElementById("event-select")?.focus()` depends on it elsewhere in the same file). Works for the user stories (search + sort active-ahead-of-completed), but isn't a true single-control combobox. **Confirm with the project owner whether to leave it or redo it as a real combobox** before touching it — it was a considered tradeoff, not an oversight.
2. **Data Clumps** (code-review finding, not actioned): the routes/geofences/locations multi-select triad in `EventPlanning.tsx` — state (`routeIds`/`geofenceIds`/`locationIds`), option lists, and JSX — is the same shape copy-pasted three times with only the "kind" swapped. `linkMany()` already unifies the linking *logic*; the selection state and markup didn't get the same treatment. Candidate for a `Record<ResourceKind, {options, selectedIds}>` refactor.
3. **Divergent Change** (code-review finding, acknowledged not actioned): `EventPlanning.tsx` now changes for about seven unrelated reasons across this cycle's commits. That's the honest cost of a spec covering many small UI items against one file; nobody's split it up.
4. **`DESIGN.md` reconciliation — offered to the project owner, no answer yet.** Worth a correction on record: an earlier pass in this cycle repeatedly claimed "no DESIGN.md exists" when reasoning about `styles.css` design-hook findings. That was **wrong** — `DESIGN.md` exists at the true repo root and predates this cycle (Aug 8). The `impeccable` skill's `context.mjs --target <path>` resolves `projectRoot` to the nearest `package.json` (i.e. `frontend/packages/onboard-console`) and doesn't walk up far enough to find a `DESIGN.md` sitting one level above `frontend/` — a tooling resolution quirk, not an actual absence. Confirmed by calling the detector's `detectText`/`loadDesignSystemForCwd` functions directly with the real repo-root `cwd`. Current count for `frontend/packages/onboard-console/src/styles.css`: **40 findings** — 1 `side-tab`, 6 `design-system-color`, 28 `design-system-font-size`, 5 `design-system-radius` — all pre-existing, none introduced by this cycle's changes (verified by line number against the actual diff). Offered as a follow-up reconciliation pass against the documented type ramp / radius scale / palette; no decision yet.
5. **Noticed in passing, not fixed, not filed:** `EventWorkspaceNav.tsx`'s "Configure" stage link construction (the `stageSuffix` ternary) appears to drop the `/admin` path prefix when building its href for that one stage — worth a second look if anyone's touching that file next, but wasn't part of issue #18 and nobody's confirmed it's actually broken end-to-end.
6. **Explicitly out of scope per issue #18** (don't mistake these for missed work): server-backed activation readiness, a "live operating scope" summary view, a resume transition out of `suspended`, and the dev-environment mock-auth panel's inability to clear 401s against real API calls (every verification pass this cycle worked around that last one by monkey-patching `window.fetch` in the browser tools — expect to do the same for any visual verification against live-ish data until it's fixed).

## Environment notes specific to this area

- `tsc -b --noEmit` at the workspace root fails on a pre-existing, unrelated composite-project error. Use `npx tsc --noEmit -p .` from inside `frontend/packages/onboard-console` instead.
- `npm run test` (from `frontend/`) runs the Vitest suite across workspaces; `npm run test --workspace @mvta/onboard-console` for just this package.
- Saved project-owner convention: bump `frontend/packages/onboard-console/package.json`'s version + add a `CHANGELOG.md` entry with every user-facing change to that package. Current version: `1.5.20`.
- Domain vocabulary for anything in this workflow ("Operating period," "Service Plan," "Event operating context," "plan revision," etc.) is canonical in root `CONTEXT.md` — don't improvise synonyms. Relevant ADRs: `docs/adr/0002-unify-event-operating-scope.md` (lifecycle model, why revisions exist) and `docs/adr/0004-version-active-event-resources.md` (why active-plan resources are pinned/versioned).

## Suggested skills for whoever picks this up

- **First thing, regardless of focus:** re-check PR #19's merge state before doing anything else.
- **For an independent freshness check:** the `impeccable` skill's `critique` command against `EventPlanning.tsx` again — the score trend so far this cycle (see `.impeccable/critique/*eventplanning*`) went 24→18→26/40; worth a fourth pass now that the spec work has landed too.
- **For item 1 (Event picker → real combobox):** `impeccable` skill (`shape` to settle the interaction pattern first — it's a real design decision, not just implementation), possibly `prototype` to sanity-check keyboard/focus behavior before wiring it in.
- **For item 2 (Data Clumps refactor):** `codebase-design` skill for the seam/deep-module vocabulary before restructuring the triplicated select/state pattern.
- **For item 4 (DESIGN.md reconciliation):** `impeccable` skill, likely `typeset` for the 28 font-size findings plus a targeted color/radius pass — target `frontend/packages/onboard-console/src/styles.css`. Re-run `/impeccable audit` (or the direct-detector-call approach noted above) for a fresh count before trusting the numbers here if anything's changed since.
- **For any further code change in this area:** `tdd` matches the pattern already established (write a failing RTL test against `EventPlanning.tsx`, then implement) — the seam is agreed and working. Finish with `code-review` (two-axis: Standards + Spec) before committing, and follow the `implement` skill's flow (typecheck → tests → review → commit) for anything spec-sized.
- **If a new backlog of findings accumulates:** `to-spec` to turn it into a fresh GitHub issue before implementing, the same way issue #18 got produced.
