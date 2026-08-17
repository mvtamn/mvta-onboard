# Handoff — get the Event Planning UX work executed by Codex

**Written:** 2026-08-17
**Repo:** `/Users/tyrefant/AI Projects/MVTA Onboard`
**Next session's job:** hand the already-scoped Event Planning UX work to Codex
and shepherd it. **Not** to design anything, and **not** to implement it
yourself unless the user redirects.

## Where things stand

Branch `event-plan-lifecycle` at `fe9ca60`. Console package typechecks clean
(0 errors), frontend suite passes (57 tests / 11 files).

The previous session ran `/impeccable critique` on `EventPlanning.tsx`
(dual-agent, scored 20/40, trend 24 → 18 → 26 → 20), landed three fixes, and
wrote an implementation brief. Nothing is half-finished.

## Artifacts — read these, don't recreate them

| Path | What it is |
|---|---|
| `docs/handoffs/event-planning-ux-findings-2026-08-17.md` | **The implementation brief.** Four ready-to-build work items with acceptance criteria, plus two exclusion lists. This is what Codex executes. |
| `.impeccable/critique/2026-08-17T05-16-44Z__kages-onboard-console-src-routes-eventplanning-tsx.md` | Full critique: heuristic scores, persona red flags, detector evidence |
| `.scratch/event-plan-lifecycle/issues/` (7 files) | **Another agent's tickets.** Off limits — see Hazards |
| commit `fe9ca60` | The three fixes already landed |
| `AGENTS.md` | Declares the tracker convention: GitHub Issues, `ready-for-agent` label |

Do not restate the findings in chat or in new files. Reference the brief.

## The task

**1. Deliver the brief to Codex.** Both documents are committed, so a fresh
checkout sees them. Three routes, discussed with the user, none chosen yet:

- **GitHub issues labeled `ready-for-agent`** — the repo's own convention per
  `AGENTS.md`. Recommended split: **four issues, one per numbered section** of
  the brief, since each is independently shippable. Needs `gh`. **Opening
  issues is outward-facing — get explicit approval before creating them.**
- **Point Codex at the committed file** — "read
  `docs/handoffs/event-planning-ux-findings-2026-08-17.md`, implement section
  1." Simplest, works immediately.
- **Paste a section into Codex directly** — loses the exclusion lists, which
  is the part that prevents collisions. Least preferred.

**2. Verify whatever Codex produces** against the acceptance criteria in the
brief, plus a clean `tsc` and green tests.

## Hazards — these will bite

**The stale-dist trap.** If `tsc` reports `route_conflict`,
`EventServicePlanRevision.links`, or a third argument to
`transitionEventServicePlan` as missing, the fix is `npm run build` in
`frontend/packages/shared` — **not** editing the types. They already exist in
`shared/src`; `shared/dist` drifts behind it. A review sub-agent took exactly
this wrong turn last session and concluded a working safety check was dead
code. Make sure Codex does not repeat it; the brief warns about it explicitly.

**A concurrent agent is active on this repo.** During the last session it
switched branches mid-run, committed, rebased the branch twice (orphaning a
commit that had to be cherry-picked back), and opened a new workspace at
`.scratch/event-avl-command-surface/`. Before doing anything, run
`git log --oneline -3` and confirm the tip is where this document says. **Ask
the user whether that session is finished before adding Codex as a third
agent on one module.**

**Two exclusion lists in the brief are load-bearing.** The seven tickets in
`.scratch/event-plan-lifecycle/issues/` own readiness, stage/next-action
derivation, atomicity, and the lifecycle module — an agent that "improves"
those collides with work in flight. And four design questions are explicitly
undecided; an agent handed them will answer confidently and build the wrong
thing.

## Decisions that belong to the user, not to any agent

The IA question — **should Event Planning be one page or four routes?** — is
open. A `/grilling` round was started and never answered. These four questions
are the agenda whenever the user wants to resume; do not answer them by
inference:

1. Who sets up special events, how often, under what time pressure?
2. Was the map's absence from all six prototype variants a decision or an
   oversight?
3. What actually repeats between two runs of a recurring event?
4. Has anyone been burned by a live activation that a static preview would
   have caught?

Useful context already gathered: five of six variants across
`prototypes/event-planning-ui.html` and
`prototypes/event-planning-ui-prototype.html` are single-page, one is a
wizard; none contains a map, a preview affordance, or duplicate/template
language. Separately, `prototypes/event-navigation-prototype.html` already
settled where Events live in the shell (first-class Events workspace) and that
shipped — do not re-open it.

Also settled by the user last session: **"Event Plan" is the canonical term**,
superseding "operating period". `CONTEXT.md` still needs updating to match —
that is section 2 of the brief.

## Environment

- Typecheck: `npx tsc --noEmit -p .` from inside
  `frontend/packages/onboard-console`. The workspace-root `tsc -b --noEmit`
  fails on a pre-existing unrelated composite-project error.
- Tests: `npm run test` from `frontend/`.
- Bump `frontend/packages/onboard-console/package.json` and add a
  `CHANGELOG.md` entry with every user-facing change — standing convention.
  Version is currently `1.5.47`.
- The app cannot be verified in a browser headlessly (Microsoft SSO + Azure
  Maps tokens). Verify by test, not screenshot.
- `/impeccable` reports an update available (v4.0.4 → v4.1.1); the user was
  asked and did not answer. Do not raise it again unprompted.

## Suggested skills

- **None to start.** Task 1 is a delivery decision that belongs to the user;
  reaching for a skill before they pick a route is premature.
- **`/code-review`** — once Codex returns work, review its diff against the
  brief's acceptance criteria. This is the main one you will need.
- **`/impeccable critique frontend/packages/onboard-console/src/routes/EventPlanning.tsx`**
  — after Codex's changes land, to see whether the score moves off 20/40. The
  snapshot and trend are already wired up, so it will diff automatically.
- **`/grilling`** — only if the user wants to resume the IA question. Start
  from the four questions above; do not restart the interview from scratch.
- **`/to-spec` then `/to-tickets`** — only *after* that grilling concludes.
  The IA work is multi-session and should not go straight to implementation.
- **Do not** reach for `/implement` or `/tdd` on the four brief sections
  yourself unless the user redirects away from Codex — the entire point of
  this handoff is that Codex executes them.
