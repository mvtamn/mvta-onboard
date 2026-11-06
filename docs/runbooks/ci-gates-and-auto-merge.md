# CI gates and auto-merge

Set up 2026-11-05 (PR #511, plus repo settings).

## What `main` requires

The ruleset **"main: PR CI gates"** requires two checks, both from GitHub
Actions:

| Check | Workflow | Waits on |
|---|---|---|
| `api-ci` | `.github/workflows/api.yml` | `changes`, `migration-numbers`, `test` (restapi + dispatch), `decision-matrix-contract` |
| `frontend-ci` | `.github/workflows/frontend.yml` | `changes`, `test`, `build` (rider-app + onboard-console) |

- "Require branches to be up to date" is **off**. Turning it on would force
  every open PR to re-merge main each time anything lands, and the changelog
  version line already conflicts often enough.
- Repository admins can **bypass** the ruleset, so direct pushes to `main` and
  admin merges still work. Everything normally lands through PRs.
- Repo setting **Allow auto-merge** is on. Squash is the merge method in use;
  merged branches are deleted.

## How the gates work

Both workflows run on **every** pull request, so the gates always report. A
required check that never starts would strand the PR.

1. `changes` diffs the PR's merge commit against the base tip. When nothing
   the workflow checks has changed, the real jobs are **skipped**.
2. The gate job runs with `if: always()`. It passes when each job it waits on
   passed or was skipped, and fails on any failure or cancellation.

Pushes to `main` and manual dispatches are unchanged. `changes` reports
relevant for them, and deploys keep their own `push.paths` filters.

## Making a new job required

Add it to the gate job's `needs:` list in the same workflow. Do **not** add the
job's own name to the ruleset. Job names repeat across workflows (both have a
`test`), and a matrix job reports under one name per matrix entry, so required
check names drift. The gate stays the only name the ruleset knows.

A new workflow that should block merges gets its own gate job, and that gate's
name is added to the ruleset:

```bash
gh api repos/mvtamn/mvta-onboard/rulesets
```

Use the GitHub Actions app as the source (`integration_id` 15368), so a
status posted by anything else cannot satisfy the check.

## Using auto-merge

```bash
gh pr merge <number> --auto --squash
```

The PR merges once both gates pass. A merge conflict, which is usually the
`CHANGELOG.md` version line, still has to be fixed by hand; auto-merge then
carries on by itself. Auto-merge does not stop two open PRs claiming the
same version: `changelogData.test.ts` only catches a duplicate after main has it.

**Backend merges restart the REST app.** A PR touching `functions-restapi/` or
`functions-dispatch/` redeploys dev on merge. Auto-merge does not know about
service hours (fixed route 4am–midnight Central), so hold auto-merge on a
backend PR you would not merge by hand during service.
