# Missed Trips and Performance Assessment handoff — 2026-08-13

## Outcome of the conversation

The missed-trip scope and its Performance Assessment pipeline were implemented and deployed. The last completed release was console version `1.5.12`, commit `932f190` (`Deploy contractor performance assessment`). Performance Assessment is a top-level console menu item at `/performance-assessment`.

Do not repeat implementation details already recorded in commits and project artifacts. Start with:

- `plans/missed-trip-detection-logic-gaps.md`
- `plans/missed-trip-feature-finish-plan.md`
- `plans/onboard-spare-integration-spec.md`
- `functions-restapi/sql/migration-027-missed-trip-operational-evidence.sql`
- `functions-restapi/sql/migration-028-spare-missed-trip-foundation.sql`
- `functions-restapi/sql/migration-029-spare-missed-trip-integration.sql`
- `functions-restapi/sql/migration-030-contractor-performance-assessment.sql`
- `functions-restapi/sql/migration-031-contractor-scorecard-views.sql`
- commits `55f70d4`, `ccc2922`, `0664bc7`, `9d3a791`, and `932f190`

## Confirmed operational state

- SQL migrations 027–031 were reported complete by the user. Earlier rerun errors were caused by partially existing objects and were addressed with rerunnable migrations.
- Spare authentication is configured through an environment setting backed by Azure Key Vault. The credential and all password details are intentionally omitted here.
- The missed-trip detector includes Spare data after commit `0664bc7`.
- The review-queue navigation and aging UX work is in `9d3a791`.
- API and frontend deployments for `932f190` succeeded.
- The assessment candidate backfill inserted four records; an immediate second run inserted zero, confirming idempotency at that point.
- The candidate poll timer was scheduled daily for 06:20 UTC (01:20 CDT).
- The Function App health endpoint and live console were healthy after deployment.
- Relevant GitHub Actions runs:
  - API: https://github.com/mvtamn/mvta-onboard/actions/runs/31270939127
  - Frontend: https://github.com/mvtamn/mvta-onboard/actions/runs/31270939132
  - Infrastructure: https://github.com/mvtamn/mvta-onboard/actions/runs/31270939104
- The infrastructure run remained red because the CI service principal lacked `Microsoft.Authorization/roleAssignments/write`. This did not block the live assessment feature because the required storage account, Function App setting, and blob role assignment were already present.

## Checkout caution recorded at handoff time

At the time the original handoff was created, the checkout was on `codex/prototype-event-workspace` at `097b99c` with unrelated event-planning changes. Preserve any such work if it is present in a future checkout; do not fold it into missed-trip or assessment changes.

Always run `git status --short --branch` before changing code and establish whether the request concerns event work or the completed missed-trip release.

## Repository working conventions

Read the root `AGENTS.md`, then follow:

- `CONTEXT.md` and `docs/adr/` for domain context
- `docs/agents/issue-tracker.md` for GitHub issue/spec workflow
- `docs/agents/triage-labels.md` for label vocabulary
- `docs/agents/domain.md` for domain-document rules

## Suggested skills

- `diagnosing-bugs` if the user reports false positives, unavailable data, pipeline failures, or production regressions.
- `code-review` if asked to assess a branch or review changes against an issue/spec.
- `domain-modeling` if continuing assessment/event ADR work or changing domain terminology.
- `github:gh-fix-ci` if asked to resolve the remaining infrastructure GitHub Actions failure.
- `github:yeet` only when the user explicitly wants a branch committed, pushed, and opened as a draft PR.
- `ponytail:ponytail` for implementation work, per the available coding-skill policy.

## Recommended next-agent opening move

If the user's first request clearly identifies the next scope, inspect the relevant artifact and current diff, preserve unrelated changes, and proceed. Ask for clarification only when the intended scope cannot be established safely.
