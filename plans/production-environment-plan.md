# Production environment — plan

Drafted 2026-10-14. Nothing here is built yet.

OnBoard has one environment, `rg-mvta-onboard-dev`, and it is already doing
production work: staff sign in to it, riders subscribe through it, Spare posts
to it, and OTP compliance figures are decided in it. `infra.yml` says so in a
comment ("effectively production"). This plan stands up a real production
environment behind `onboard.mvta.com` (staff console) and `alerts.mvta.com`
(rider sign-up), and turns dev back into a place to test.

The custom domains are the last step, not the first: the CNAME target and the
domain-validation TXT codes come from production's Front Door, which does not
exist yet.

## Decisions to make first

Each has a recommendation. The steps below assume it.

### 1. Build a new environment, or rename dev as production?

| | Build `rg-mvta-onboard-prod` | Keep dev as production |
|---|---|---|
| Effort | Weeks: everything below | Days: domains, settings, a new dev later |
| Names | Clean (`-prod`) | `-dev` on every production resource, forever (Azure resources cannot be renamed) |
| Proves the stack can be rebuilt | Yes — and finds what was hand-built | No |
| Somewhere safe to test afterwards | Dev, immediately | Only after building a new dev |
| Cost | About another $400/month while both run | Unchanged until a new dev exists |

**Recommendation: build production.** Front Door, Azure Maps and Communication
Services were all built by hand in the portal, so today nobody knows whether
the environment can be rebuilt. Doing it once now, deliberately, is cheaper
than finding out during an outage.

### 2. How does production's database start?

There is no migration runner and no schema-version table
(`functions-restapi/sql/README.md`). `sql/` holds `phase1-schema.sql` plus
about 147 numbered migrations. Some are not re-runnable, some numbers carry
letter suffixes, and nobody has ever applied the whole chain to an empty
database.

- **Copy dev's database at cutover (recommended).** Azure SQL can copy a
  database to another server in the same subscription. Production gets the
  exact schema and all the real records: subscribers, detours, assessments,
  OTP decisions, role grants. Dev keeps its own copy and diverges from then on.
- **Build empty and replay migrations.** Clean, but untested, and it loses
  every record staff have already made in dev.

Either way, do this as a separate job: prove the migration chain builds a
database from nothing in a throwaway SQL container (CI already starts one for
the Decision Matrix contract tests). A rebuild should not depend on dev
existing.

### 3. Same sign-in registration, or a new one for production?

The console and API use one Entra app registration (`MVTA OnBoard`,
`7e5a35b1-…`). If production shares it, a token issued to dev is accepted by
production's API, because both have the same audience.

**Recommendation: a separate `MVTA OnBoard (Production)` registration.**
The cost is that until app-owned roles increment 6 ships (see
`plans/app-owned-roles-plan.md`), the `OCC.*` app roles in the token still
authorize requests, so every production user needs app roles assigned on the
new registration too. Shipping increment 6 first makes this much smaller. That
choice is the owner's.

Also decide what to do with:
- The rider app registration (`560667df-…`, listed in `HANDOFF.md` §3). Find
  out whether anything still uses it before copying it.
- The leftover web redirect `https://onboard.mvta.org/.auth/login/aad/callback`
  on the current registration. It is `.org`, not `.com`, and is probably from
  an early Easy Auth attempt. Remove it.

### 4. What does dev do after cutover?

Both environments would otherwise poll the same Avail and Spare feeds, post to
the same Teams channels, and send real texts and emails to riders.

**Recommendation:** dev keeps polling (so it has live data to test against)
but:
- its Teams webhook secrets point at a test channel or are removed;
- its ACS sender is removed, so it sends nothing to riders (the senders do
  nothing when unconfigured);
- Spare's webhook points at production only.

Downsize dev too: drop SQL from S3 to S0 or Basic, and consider one shared B1
plan instead of three.

### 5. Rider messaging identity

- **Email:** dev sends from an Azure-managed `…azurecomm.net` address. Production
  should send from an MVTA domain such as `alerts@mvta.com` or
  `noreply@alerts.mvta.com`. That needs a custom domain on ACS Email, which
  means more DNS records for the web admin (domain verification TXT, SPF,
  two DKIM CNAMEs). Send them in the same request as the site records.
- **SMS:** `acsSmsFrom` is empty even on dev, so no texts go out anywhere
  today. Buying a toll-free number and getting it verified takes weeks, so
  start that early if texts are needed at launch.

### 6. Region and sizes

Stay in **West US 2**. Central US and East US had no App Service quota on this
subscription (`HANDOFF.md` §3). Test quota for four B1 plans before deploying
(`az appservice plan create --sku B1 --is-linux`). Start production at dev's
sizes (B1 plans, SQL S3, Front Door Standard) and adjust once real load shows.

## Steps

The numbers give the order. Steps marked **(owner)** need an Azure or Entra
administrator, not the deploy pipeline.

### A. Make the repo deploy to more than one environment

Every workflow hard-codes dev today.

1. **Parameter files.** Add `infra-stage0/parameters/prod.parameters.json` and
   `infra-phase1/parameters/phase1-prod.parameters.json` with a new
   `uniqueSuffix` (Key Vault, SQL and storage names are global). Start every
   feature flag at the value dev runs today.
2. **`infra.yml`, `api.yml`, `frontend.yml`.** Take the environment as an
   input. Derive resource group, app names, parameter files and the smoke-test
   URL from it instead of the literal `-dev` names (`api.yml` names
   `func-mvta-*-dev` and `rg-mvta-onboard-dev`; `infra.yml` hard-codes the
   Front Door hostname in its health check). Main keeps deploying to dev
   automatically. Production deploys only through `workflow_dispatch`, gated by
   a GitHub `prod` environment with required reviewers.
3. **Frontend build variables.** `VITE_API_BASE`, `VITE_ENTRA_CLIENT_ID`,
   `VITE_ENTRA_TENANT_ID`, `VITE_API_SCOPE` and `VITE_PRIVILEGED_AUTH_CONTEXT`
   are repository variables today, and the build job has no `environment:`.
   Move them, and the `SWA_TOKEN_*` secrets, into GitHub environments so each
   environment builds with its own values.
4. **`deploy.sh`.** It always passes `manageSqlConnectionStringSecret=false`.
   Add a first-provision option that writes the SQL connection-string secret
   once.
5. **Azure Maps.** `main-phase1.bicep` names the account `mvta-onboard-maps`
   with no environment in it. Add the environment to the name for production.

### B. Azure foundation

6. **(owner)** Give the deploy identity a federated credential for the GitHub
   `prod` environment and Contributor on `rg-mvta-onboard-prod`.
7. Run stage 0 for production (`deploy.sh prod`, first-provision mode). This
   creates the resource group, network, Key Vault, SQL server and database,
   private DNS, Log Analytics and App Insights. Generate a new SQL admin
   password and keep it in the password manager.
8. **(owner)** Load production's Key Vault secrets: `sql-connection-string`
   (written by step 7), `spare-api-key`, `spare-webhook-auth-secret`,
   `avail-avl-reports-api-key`, `anthropic-api-key`,
   `onboard-api-client-secret`, `decision-matrix-health-client-secret`,
   `teams-event-webhook-url`, `teams-detour-webhook-url`. The vault is
   private-only, so this needs the same temporary-access dance dev needed.
   Decide per secret whether production gets its own value: a separate Spare
   webhook secret is cheap and stops dev from accepting production deliveries.
9. Run phase 1 for production with **`manageRoleAssignments: true`**, run by an
   Owner, so the apps get their Key Vault, storage and Service Bus roles in one
   pass rather than the manual grants dev needed (`HANDOFF.md`, "Spare webhook
   receiver", step 2).
10. **(owner) Front Door, in the portal.** The Bicep module never worked
    (`main-phase1.bicep` header). Create `afd-mvta-onboard-prod` (Standard)
    with three origin groups and routes matching dev:
    `/console/*` → console SWA, `/api/*` → REST API, `/*` → rider SWA. Attach
    the WAF policy from step 9 through a security policy. Record the
    `FrontDoorId` as the prod environment's `FRONT_DOOR_ID` variable, then
    re-run phase 1 so the Function Apps accept traffic only from it.
11. **(owner) Communication Services.** Create ACS and an ACS Email service for
    production, and add the custom email domain from decision 5. Start the
    toll-free number purchase and verification if texts are needed.

### C. Sign-in

12. **(owner) Register the production app registration** (decision 3):
    single tenant; expose the API scope; add the `OCC.*` app roles; add SPA
    redirect `https://onboard.mvta.com/console/`; create its client secret
    (step 8's `onboard-api-client-secret`).
13. **(owner) Assign people to the registration**: Entra app roles until
    app-owned roles increment 6 ships, plus the OnBoard Users group if
    "Assignment required" is on.
14. Fill in production's `aadClientId`, `accessManagementConfigJson`
    (application id, service principal id, group ids, and
    `guest_redirect_url: https://onboard.mvta.com/console/`) and
    `allowedCorsOrigins: ["https://onboard.mvta.com", "https://alerts.mvta.com"]`.
    Set `riderAppBaseUrl: https://alerts.mvta.com`; it builds the links in
    confirmation and alert messages.
15. **(owner)** Grant the production API identity the same SharePoint and Graph
    access dev has for the Decision Matrix library (see
    `docs/runbooks/decision-matrix-sharepoint-documents.md` and
    `scripts/setup-decision-matrix-documents-identity.sh`).

### D. Domains

16. Add `onboard.mvta.com` and `alerts.mvta.com` as custom domains on
    production's Front Door and associate both with all three routes. Azure
    then issues the two `_dnsauth` TXT codes.
17. **Send the DNS request to the web admin.** mvta.com's DNS is hosted by the
    State of Minnesota (`ns1-3.state.mn.us`), so it may go through MNIT.
    Records: two CNAMEs to production's `*.azurefd.net` endpoint, the two
    `_dnsauth` TXT records (they expire after 7 days), and the ACS email
    records from step 11.
18. Optional: a Front Door rule that sends `onboard.mvta.com/` to `/console/`
    and `alerts.mvta.com/console/*` to `onboard.mvta.com/console/`, so each
    hostname shows only its own app.

### E. Code and data

19. Run the api and frontend workflows for production. Verify each Function App
    the usual way (Kudu `packagename.txt`, not the green check) and each SWA by
    grepping its bundle for the version.
20. With production's timers still off, sign in at
    `https://onboard.mvta.com/console/` against an empty or copied database to
    prove sign-in, `/api/me/access` and the health page work end to end.

### F. Cutover

Pick a quiet window. Fixed route runs 4am–midnight Central, so overnight works.

21. Turn dev's writers off: stop the dev REST API and sparehook apps, or at
    least their timers, so nothing new is written to dev's database.
22. Copy dev's database to production's server (decision 2) and confirm
    Integrations & Data Health shows no schema drift.
23. Start production's apps. Watch the first poll of every feed on Integrations
    & Data Health.
24. **Repoint Spare's webhook** in Spare's admin to
    `https://func-mvta-sparehook-prod.azurewebsites.net/api/on-demand-webhooks/spare`
    with production's secret.
25. Apply decision 4 to dev (Teams, ACS, sizes), then restart dev on its
    diverged copy.
26. Tell staff the new address. Links in alerts already sent to riders point at
    dev's Front Door hostname. Decide whether dev's rider app should redirect
    to `alerts.mvta.com` for a while so those links keep working.

### G. Afterwards

27. Update `HANDOFF.md` §3 with production's identifiers, and correct the
    "dev is the ONLY live environment" comments in `infra.yml`.
28. Add a runbook: applying migrations to production (the
    `apply-dev-migrations.sh` wizard is dev-only), and the order is always dev
    first, then production.

## Open questions for the owner

- Decision 1–6 above.
- Does Spare allow more than one webhook URL? If so, dev can keep receiving
  deliveries; if not, dev's on-demand monitor goes quiet after step 24.
- Is there a firm launch date for `alerts.mvta.com`? It decides whether SMS
  verification (decision 5) has to start now.
- Who besides the owner needs production access on day one?
