# Test & Production Environment Plan

Status: proposed, not started. Written 2026-08-06.

Goal: go from one live environment (`dev`, which today is effectively
production) to three — `dev`, `test`, `prod` — with a reviewed promotion path
and no risk of a test deploy contacting real riders.

---

## 0. Where we actually stand

**Already multi-env.** Both Bicep templates were written with this in mind and
need no structural change:

- `@allowed(['dev', 'test', 'prod']) param environment` in
  [main.bicep:4](../infra-stage0/main.bicep) and
  [main-phase1.bicep:12](../infra-phase1/main-phase1.bicep).
- Every resource name interpolates it — `func-mvta-restapi-${environment}`,
  `kv-mvta-${environment}-${uniqueSuffix}`, `vnet-mvta-onboard-${environment}`,
  `stapp-mvta-onboard-${environment}`, `appi-mvta-onboard-${environment}`, and
  the `take(...)` storage account names.
- CI already authenticates with OIDC federated identity — no cloud credentials
  stored in GitHub.

**Not multi-env yet.** Six things block a second environment:

| # | Gap | Where |
|---|-----|-------|
| 1 | Only `dev` parameter files exist | `infra-stage0/parameters/`, `infra-phase1/parameters/` |
| 2 | All three workflows hardcode dev | `.github/workflows/*.yml` |
| 3 | Front Door is manual portal work; the Bicep module is known-broken | [main-phase1.bicep:2-9](../infra-phase1/main-phase1.bicep) |
| 4 | 23 hand-applied SQL migrations, no runner, no ledger table | `functions-restapi/sql/` |
| 5 | One shared Entra app registration; no code-level env guardrails | `aadClientId` param; `ENVIRONMENT` app setting is set but never read |
| 6 | No promotion model — push to `main` deploys straight to the live env | `.github/workflows/*.yml` triggers |

---

## 1. Prerequisite: a migration runner

**Do this before standing up any new environment.** One environment makes
hand-applied SQL survivable. Three guarantees drift, and there is currently no
way to even detect it.

Current state:

- 23 files, `functions-restapi/sql/migration-001…023-*.sql`, plus
  `phase1-schema.sql` as the baseline.
- No `schema_version` (or equivalent) table anywhere in the schema.
- Migrations are **not idempotent** — e.g. migration-023 opens with
  `ALTER TABLE MonitoredMissedTrips ADD detection_type NVARCHAR(30) NULL;`,
  which errors on a second run. So apply-once bookkeeping is required, not
  optional.
- Files use `GO` batch separators. The `mssql` node driver does **not**
  understand `GO`, so the runner must split each file on `GO` boundaries and
  submit the batches in order.

Deliverables:

1. `migration-000-schema-version.sql` — creates
   `SchemaVersion(migration_id NVARCHAR(100) PRIMARY KEY, applied_at DATETIME2,
   applied_by NVARCHAR(200), checksum NVARCHAR(64))`.
2. `functions-restapi/scripts/migrate.mjs` — reads `sql/migration-*.sql` in
   filename order, skips ids already in `SchemaVersion`, splits on `GO`, runs
   each file in a transaction where the batching allows, records the row.
   Flags: `--dry-run` (print the pending list and exit), `--to <id>`.
3. Checksum verification: warn loudly if a file's checksum differs from the
   recorded one — that means someone edited an already-applied migration.
4. Backfill: mark migrations 001–023 as applied in dev without re-running them
   (dev's schema is already current — note that 011 was applied by hand on
   2026-07-27). For test/prod the runner applies everything from the baseline.
5. `npm run migrate` script in `functions-restapi/package.json`.

Open question for you: should the runner be a CI step (needs a CI path into the
VNet-private SQL server, or a firewall exception for the runner IP) or a
documented manual step run from a jump position? **Recommendation:** CI step for
`test`, manual-with-approval for `prod` initially, until the runner has proven
itself on a few real migrations.

---

## 2. Parameter files

Add four files, mirroring the existing dev pair:

- `infra-stage0/parameters/test.parameters.json`
- `infra-stage0/parameters/prod.parameters.json`
- `infra-phase1/parameters/phase1-test.parameters.json`
- `infra-phase1/parameters/phase1-prod.parameters.json`

Decisions baked into them:

- **`uniqueSuffix`** — keep `mvta-jx4471` across all three. The env name is
  already in every resource name, so global uniqueness holds, and a shared
  suffix keeps names predictable. (Alternative: a distinct suffix per env for
  extra blast-radius separation. Not worth the naming churn.)
- **`location`** — `westus2` everywhere, matching dev.
- **`aadClientId`** — a *different* app registration per environment. See §5.
- **`wafSku`** — `Standard_AzureFrontDoor` for dev/test. For prod, consider
  `Premium_AzureFrontDoor`, which is what unlocks the managed rule sets
  [wafpolicy.bicep](../infra-phase1/modules/wafpolicy.bicep) currently can't
  use. This is a real cost increase — flag for approval, don't assume it.
- **`allowedCorsOrigins`** — per-env SWA/Front Door hostnames. Not known until
  the env exists, so these get filled in on the second deploy pass.

Also needed: resource groups `rg-mvta-onboard-test` and `rg-mvta-onboard-prod`,
and a `sqlAdminPassword` per environment stored as an environment-scoped GitHub
secret (never reused across environments).

### Cost shaping for `test`

Do not mirror prod. Per environment today: 2 × B1 App Service plans, SQL DB,
2 × Standard Static Web Apps, Service Bus, 3 × storage accounts, Azure Maps,
Front Door. Tripling that is a real budget line.

Suggested `test` trims — all are existing Bicep parameters, so this is
parameter-file work, not template work:

- Both Function Apps share **one** hosting plan (currently each module creates
  its own `plan-${functionAppName}`; sharing needs a small module change to
  accept an existing plan id — the one template edit in this plan).
- SQL at the lowest usable tier.
- Static Web Apps: `Free` instead of `Standard` — but note the comment in
  [main-phase1.bicep:95](../infra-phase1/main-phase1.bicep) that Standard is
  what makes `staticwebapp.config.json` security headers and routing take
  effect. If test is meant to validate routing behavior, it must stay Standard.
  **Recommendation:** keep Standard in test; the routing behavior is exactly
  the kind of thing test exists to catch.

---

## 3. Workflows: de-hardcode dev

This is the bulk of the CI work. All three workflows are pinned to dev today.

### `infra.yml`

Hardcoded: `environment: dev`, `RESOURCE_GROUP: rg-mvta-onboard-dev`, both
parameter-file paths, and a literal dev Front Door hostname in the final smoke
test (`endpoint-mvta-onboard-dev-…z03.azurefd.net/api/health`).

Changes:

- Convert to a reusable workflow (`workflow_call`) taking an `environment`
  input, plus a thin caller with `workflow_dispatch` + a choice input.
- Derive `RESOURCE_GROUP: rg-mvta-onboard-${{ inputs.environment }}` and both
  parameter paths from the input.
- Move the health-check hostname to an environment-scoped variable
  (`vars.HEALTH_CHECK_URL`) — each env has its own Front Door hostname.
- Keep the `what-if` step before every deploy. It matters more with three
  environments, not less.
- `concurrency` group must include the environment so a test deploy can't be
  cancelled by, or race, a prod deploy.

### `api.yml`

Hardcoded: `environment: dev` and the matrix's `func-mvta-restapi-dev` /
`func-mvta-dispatch-dev`.

Changes: derive both app names as `func-mvta-restapi-${{ inputs.environment }}`
etc. The `test` job (build + unit tests) stays env-independent and gates all
deploys.

### `frontend.yml`

Hardcoded: one `SWA_TOKEN_RIDERAPP` / `SWA_TOKEN_ONBOARD` pair and one set of
`VITE_*` build variables.

Changes: both become environment-scoped GitHub secrets/variables, so the same
secret *names* resolve to different values per environment. The
`VITE_API_BASE`, `VITE_ENTRA_CLIENT_ID`, `VITE_API_SCOPE` values differ per env
by definition. Note the `onboard-console` `dist-wrapped` quirk (the `/console/*`
Front Door prefix workaround in `wrap-dist.mjs`) applies identically in every
environment — no per-env variation there.

### GitHub Environments

Create `test` and `prod` alongside the existing `dev`:

- Per-environment `vars`: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID`, `FRONT_DOOR_ID`, `HEALTH_CHECK_URL`, all `VITE_*`.
- Per-environment `secrets`: `SQL_ADMIN_PASSWORD`, `SWA_TOKEN_*`.
- **`prod` gets required reviewers** — the approval gate is the point.
- A separate deployment app registration + federated credential per
  environment, each with least-privilege RBAC scoped to *only* its own resource
  group. Today's single identity having write access to all three environments
  would defeat the separation.

---

## 4. Front Door (the biggest manual lift)

Per the header comment in
[main-phase1.bicep:2-9](../infra-phase1/main-phase1.bicep), Front Door was built
by hand in the Azure Portal after `frontdoor.bicep` hit a persistent
`"Policy ArmResourceId has incorrect formatting"` error across every variation
tried. The module is still in the repo but is not deployed.

Each new environment therefore needs the portal sequence repeated: profile
(Standard) → origin group + origin for the Static Web App → origin group +
origin for the REST API → the `/api/*` path-based route → WAF association as a
separate step.

**Recommendation:** spend a bounded amount of time (half a day, no more) trying
to fix `frontdoor.bicep` before building two more profiles by hand. Two more
manual builds means three hand-configured, drift-prone edge configurations and
no way to diff them. If the fix fails again, document the portal sequence as a
numbered runbook so at least the manual path is repeatable.

Downstream dependency: `frontDoorId` and the Front Door hostname aren't known
until the profile exists, so each new environment deploys in two passes —
infra without `frontDoorId` (inbound open), then Front Door, then infra again
with `frontDoorId` set to lock inbound to Front Door only. That's the existing
deliberate-rollout design in
[functionapp.bicep](../infra-phase1/modules/functionapp.bicep), and it works in
our favor here.

---

## 5. Isolation: test must not touch real riders

**This is the item that hurts most if deferred**, and it needs application code
changes, not just infra.

Current state: `ENVIRONMENT` is set as an app setting by
[functionapp.bicep](../infra-phase1/modules/functionapp.bicep) but is **never
read anywhere** in `functions-restapi/src` or `functions-dispatch/src`. There
are no environment-aware guardrails at all.

Outbound side effects that need containment:

- **SMS and email** — `functions-dispatch/src/lib/acs.ts` reads `ACS_ENDPOINT`,
  `ACS_SMS_FROM`, `ACS_EMAIL_FROM`. A test environment pointed at the real ACS
  resource with real subscriber rows in its database will send real messages to
  real people.
- **Upstream feeds** — `GTFS_STATIC_URL`, `GTFS_RT_*`, and the six `AVAIL_*`
  endpoints. These are read-only, so pointing test at the live feeds is
  acceptable and arguably desirable (test should see real data shapes). Watch
  for rate limits and per-key quotas on the Avail endpoints.
- **`RIDER_APP_BASE_URL`** — must be the test rider app, or confirmation links
  in test messages point at production.

Proposed guardrails:

1. A `DISPATCH_MODE` app setting (`live` | `dry-run` | `allowlist`), read in
   `acs.ts`. In `dry-run`, log the fully-rendered message and return success
   without calling ACS. Default to `dry-run` when `ENVIRONMENT !== 'prod'`, so
   the safe behavior is the one you get by forgetting to configure it.
2. `allowlist` mode for end-to-end verification: send only to numbers/addresses
   in an explicit allowlist secret (staff phones), drop everything else with a
   log line.
3. Seed test's database with synthetic subscribers only. If prod data is ever
   copied down for debugging, subscriber contact fields must be scrubbed in the
   same step — not "later."
4. Separate Entra app registration per environment. One shared `aadClientId`
   across three environments means shared app roles and redirect URIs; a test
   sign-in would issue tokens an audience check can't distinguish from prod.
   Each env gets its own registration, its own redirect URIs, and its own role
   assignments.
5. Separate ACS resource (or at minimum a separate sender identity) for prod,
   so a misconfigured test env cannot burn prod's sender reputation.

---

## 6. Promotion model

Today: push to `main` deploys immediately to the live environment. The
`infra.yml` comment says it plainly — dev "is the ONLY live environment (no
test/prod yet) — it is effectively production."

Target:

- Push to `main` → auto-deploy to **test**. Runs unit tests, `what-if`, deploy,
  migrations, smoke test.
- Git tag `v*` (or manual dispatch) → deploy to **prod**, gated on the `prod`
  GitHub Environment's required reviewers, deploying the *same* commit that
  passed test.
- **dev** becomes a scratch/experiment environment once test exists, deployed
  on demand rather than on every push. It stops being load-bearing.
- Rollback: Function Apps can redeploy a prior package; SWAs keep prior
  versions. Bicep rollback is "deploy the previous template," which is why
  `what-if` output in the run log matters. Database migrations are the genuinely
  hard case — forward-only, and any destructive migration needs an explicit
  paired down-script reviewed before it merges.

---

## 7. Sequencing

1. **Migration runner + `SchemaVersion` table + dev backfill.** Gates
   everything else. (§1)
2. **Parameterize the three workflows**; verify by re-deploying dev through the
   new reusable-workflow path with no behavior change. Proving the refactor
   against the env that already exists de-risks it.
3. **Stand up `test` end-to-end**: resource group → stage 0 → phase 1 (no
   `frontDoorId`) → Front Door → phase 1 again with `frontDoorId` → migrations
   → frontends → smoke test.
4. **Add the isolation guardrails** (§5) and verify in test — confirm `dry-run`
   actually suppresses ACS sends before any real subscriber data exists
   anywhere near it.
5. **Wire the promotion path**: `main` → test automatically.
6. **Stand up `prod`** the same way, with required reviewers, and cut dev down
   to scratch status.

Items 1–2 are pure repo work with no new Azure spend. Item 3 is where cost
starts. Worth confirming the budget for a second (and third) environment before
step 3, since the answer may change the `test` shaping in §2.

---

## 8. Decisions needed from you

- Budget approval for a second and third environment, and whether `test` should
  be trimmed as suggested in §2.
- Prod WAF: stay Standard, or pay for Premium to get managed rule sets?
- Migration runner in CI (needs a network path to private SQL) or documented
  manual run?
- Is one more attempt at fixing `frontdoor.bicep` worth half a day, or do we
  accept manual portal builds and write the runbook?
