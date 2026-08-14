# MVTA OnBoard Detour feature handoff

## Continuation focus

Continue Detour feature work from the completed ticket-15 implementation. The immediate prior request was to create this handoff; no new implementation scope was supplied.

## Repository and state

- Repository: `/Users/tyrefant/AI Projects/MVTA Onboard`
- Domain guidance: `AGENTS.md`, `CONTEXT.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/domain.md`.
- Ticket-15 implementation is committed on the current branch as `c7154b2` (`feat(detour): implement orthogonal workflow state model`).
- The worktree still contains unrelated user changes. Preserve them; do not reset, clean, or broadly stage files.

## Completed work

Ticket 15 established the orthogonal Detour model:

- Workflow state: `approved`, `awaiting_fulfillment`, `fulfilled`, `fulfillment_failed`, `closed`.
- Temporal status remains derived: `monitor`, `upcoming`, `active`, `recently_finished`, `expired`.
- Fulfillment mode remains independent: `avail`, `fixed_route_manual`, `mobility_manual`.
- Intake rejection/duplication is owned by Detour Intake, not authoritative Detour workflow.
- Workflow/source observations/corrections/fulfillment confirmations are audited in `DetourWorkflowHistory`.

Implementation references:

- `functions-restapi/src/lib/detourWorkflow.ts`
- `functions-restapi/sql/migration-046-detour-orthogonal-state.sql`
- `functions-restapi/src/functions/detourWorkflowHistory.ts`
- `functions-restapi/src/functions/detoursWorkflow.ts`
- `functions-restapi/src/functions/availDetoursSync.ts`
- `functions-restapi/src/functions/detourIntake.ts`
- `frontend/packages/shared/src/types.ts`
- `frontend/packages/onboard-console/src/routes/Detours.tsx`
- `CONTEXT.md`

## Verification already completed

- Backend full suite: 268/268 passing.
- Focused workflow/validation tests: 66/66 passing.
- Frontend build passed for shared, rider-app, and onboard-console.
- `git diff --check` passed.

## Wayfinding references

- GitHub map: https://github.com/mvtamn/mvta-onboard/issues/12
- Detour source/ownership issue: https://github.com/mvtamn/mvta-onboard/issues/14
- Canonical operational journey: https://github.com/mvtamn/mvta-onboard/issues/13
- Orthogonal state model: https://github.com/mvtamn/mvta-onboard/issues/15
- Ticket 16 was updated to depend on ticket 15 and is the likely next Detour frontier.

## Suggested skills

- `mattpocock-skills:implement` for the next approved ticket, using TDD and preserving the isolated-change discipline.
- `mattpocock-skills:code-review` when reviewing changes against the ticket/spec and repository standards.
- `mattpocock-skills:domain-modeling` if the next work changes Detour terminology or state ownership.
- `mattpocock-skills:tdd` for new transition, migration, API, or integration behavior.
- `github:github` for issue orientation and `github:yeet` only when explicitly asked to publish changes.

## Safety notes

Do not expose credentials or personal data. Before any commit, inspect staged paths and ensure unrelated existing modifications remain unstaged.
