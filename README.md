# MVTA OnBoard

Transit-rider notification system for Minnesota Valley Transit Authority. Staff
compose service announcements in a web console; alerts fan out to riders via the
public web, SMS, and email. See [HANDOFF.md](HANDOFF.md) for full project
background and the live Azure environment details.

## Repository layout

```
frontend/                    React + Vite + TypeScript monorepo (npm workspaces)
  packages/
    shared/                  Design tokens, typed API client, domain types
    rider-app/               PUBLIC: Service Alerts + rider opt-in  → stapp-mvta-riderapp
    onboard-console/         STAFF (Entra/MSAL): dashboard, compose, audit → stapp-mvta-onboard
                             + OCC Tools (OCC.Admin-gated): Event Monitoring,
                               Decision Matrix, OTP Compliance (src/routes/modules/)
functions-restapi/           REST API (Azure Functions, Node 20, TypeScript — compiled to dist/)
  src/functions/             health, messages/active, messages (create), subscribers
  src/lib/                    db, auth, validation, events (Service Bus publish), types
  sql/                        schema + migrations
functions-dispatch/          Dispatch handler (TypeScript; Service Bus triggers → ACS SMS/email)
infra-stage0/                Bicep: VNet, private endpoints, Key Vault, SQL, monitoring
infra-phase1/                Bicep: Function Apps, Static Web Apps, Service Bus, WAF policy
.github/workflows/           CI/CD: infra.yml, frontend.yml, api.yml (OIDC, no stored secrets)
```

The old single-file HTML pages are superseded by the `frontend/` apps: Service
Alerts was ported into `rider-app`, and the Event Monitoring, OCC Decision
Matrix, and OTP Compliance mockups were ported into `onboard-console` as
OCC.Admin-gated modules (React's automatic output escaping removes the
stored-XSS risk; no inline scripts or font CDNs, so the strict CSP holds). The
original files are preserved in `retired-mockups/` as design references.

## Local development

```bash
# Frontend
cd frontend && npm install
npm run dev:rider        # rider app on :5173
npm run dev:console      # staff console on :5174  (needs Entra env vars, see .env.example)

# REST API
cd functions-restapi && npm install && npm test && npm start
```

Copy each `*.env.example` / `local.settings.json.example` to the real file and
fill in values. Real config files are git-ignored.

## Security posture (production-grade)

- **Edge:** WAF policy defined as code (`infra-phase1/modules/wafpolicy.bicep`)
  with rate-limiting; associate it with the Front Door (see that file's header).
  Function App inbound can be locked to Front Door only via the `frontDoorId`
  parameter (default open, roll out deliberately).
- **Auth:** staff console authenticates with Entra ID (MSAL) and gates by app
  role; the API enforces roles server-side (`src/lib/auth.js`). Rider endpoints
  are public by design.
- **Identity, not secrets:** host Storage and Service Bus use managed identity
  (`AzureWebJobsStorage__accountName`, `disableLocalAuth: true` + role
  assignments). SQL connection string stays a Key Vault reference. (SQL → Entra
  managed-identity auth is the next hardening step — see the plan.)
- **Frontend headers:** CSP + HSTS + `X-Frame-Options` etc. via each app's
  `staticwebapp.config.json`.
- **Rider PII / regulatory:** double opt-in (per-channel confirmation token)
  before any send; STOP/HELP handling required before production SMS.

## Deploy (CI/CD)

> **dev is the only live environment.** There is no test/prod yet, so `dev` is
> effectively production: rider-facing pages and the API serve from it. Infra
> deploys run a `what-if` first and smoke-test `/api/health` through Front
> Door afterward; sequence risky changes (identity migration, inbound
> lockdown) one at a time and verify between each.

Pushes to `main` trigger the workflows in `.github/workflows/`. Azure auth uses
**OIDC federated identity** — configure a federated credential on a deployment
app registration and set the `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` /
`AZURE_SUBSCRIPTION_ID` repo **variables** (not secrets). Per-workflow secrets:
`SQL_ADMIN_PASSWORD`, `SWA_TOKEN_RIDERAPP`, `SWA_TOKEN_ONBOARD`.

## What's built vs. pending

Built: the two frontends, `POST /messages` (with Service Bus publish),
`GET /messages/active`, `POST /subscribers` (double opt-in), the dispatch
handlers (SMS/email via ACS, guarded until ACS is configured), infra hardening,
and CI/CD.

Pending (see task list / plan): **Azure Communication Services provisioning**
(phone number + verified email domain — a portal step that unblocks live send),
the confirmation-back endpoints (`confirm-email`, SMS code confirm,
STOP/HELP webhook), and the `GET /admin/messages?tag=` backend for the console
audit view.
