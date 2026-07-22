# MVTA OnBoard — Project Handoff to Claude Code

**Purpose of this document**: full context for continuing development in Claude Code. Written after a long infrastructure build session in Claude chat — everything here is real and verified, not aspirational. Where something is untested or incomplete, it's flagged explicitly.

---

## 1. What this project is

MVTA OnBoard is a transit rider notification system for Minnesota Valley Transit Authority (MVTA). Staff compose service announcements (delays, detours, outages) in a web console; Claude parses free text into structured data; the result fans out to riders via website, SMS, email, and (later) push notifications, digital signage, and social media. It also includes proactive delay detection (GTFS-Realtime for fixed-route, SpareLabs/"Zona" for demand-response) that suggests alerts for staff to review and approve — never auto-published.

Two source documents define the full design (referenced throughout this handoff, ask the user for these if not already in your context):
- `Transit_Notification_Architecture.docx` — full architecture, schema, API spec, security design
- `MVTA_OnBoard_Infrastructure_Plan.docx` — original phased infrastructure plan (superseded in some details by what actually got built — this handoff is the source of truth for current state)

## 2. Current priority (per project owner, most recent direction)

1. **SMS + email dispatch is the centerpiece of the proof of concept** — not a stretch goal. Getting a rider a real text/email is the demo's core "wow" moment.
2. **Frontends continue as already designed** — Service Alerts (done, live), MVTA OnBoard dashboard, rider opt-in page. Don't redesign these; wire the existing mockups to real endpoints.
3. **Predictive/automated decision-making (delay & wait-time detection) must stay human-reviewed.** This is already how it's architected (a `SuggestedAlerts` queue with approve/dismiss, nothing auto-publishes) — just don't let this slip when building it out. The project owner was explicit that this stays on their table, not automated away.
4. This is explicitly a **proof of concept for an internal team demo**, not yet a production build. Full production (Phases 2-4: signage, social, push, delay detection, reporting) is designed but intentionally deferred.

## 3. Azure environment — current real state

**Everything below is West US 2**, in resource group `rg-mvta-onboard-dev`. This is NOT the original region — Central US and East US both had zero App Service quota on this subscription; West US 2 was confirmed to have room via direct testing before committing to it. If you ever need to provision new App Service-family resources and hit `SubscriptionIsOverQuotaForSku`, don't assume it's a code problem — test the region directly first with `az appservice plan create --sku B1 --is-linux` before debugging further.

### Identifiers to reuse (do not regenerate)
```
Resource group:        rg-mvta-onboard-dev (West US 2)
uniqueSuffix:           mvta-jx4471
Key Vault:              kv-mvta-dev-mvta-jx4471
SQL Server:             sql-mvta-dev-mvta-jx4471.database.windows.net
SQL Database:           sqldb-mvta-onboard-dev
SQL admin login:        mvtaonboardadmin
REST API Function App:  func-mvta-restapi-dev
Dispatch Function App:  func-mvta-dispatch-dev
MVTA OnBoard SWA:        stapp-mvta-onboard-dev
Rider opt-in SWA:        stapp-mvta-riderapp-dev
Service Bus namespace:  sb-mvta-onboard-dev (queue: message-created-events)
Front Door endpoint:    endpoint-mvta-onboard-dev-haehgsbbe6esd8cc.z03.azurefd.net
MVTA OnBoard app reg:    7e5a35b1-dc1b-473d-987d-6942a7b4fae2 (has 4 app roles: OCC.Viewer, OCC.Publisher, OCC.Admin, System.Ingestion)
Rider app registration:  560667df-caa4-4287-a30c-44672d1ef994
Entra ID groups:         MVTA OnBoard - Viewers / Publishers / Admins (all exist, currently empty)
```

The SQL admin password is NOT recorded here deliberately — it lives in Key Vault as the secret `sql-connection-string` (full connection string, not just the password) and in the project owner's password manager. Ask before assuming you need it directly; the Function Apps already read it via Key Vault reference.

### What's deployed and VERIFIED WORKING (tested live, not just deployed)
- VNet, private endpoints + private DNS zones for SQL and Key Vault (resources inside the VNet can resolve them correctly)
- SQL Database with full Phase 1 schema: `Messages`, `ExpirationDefaults` (pre-seeded), `Subscribers`, `SmsDeliveryLog`, `EmailDeliveryLog`
- `GET /api/health` — returns `{"status":"healthy"}`
- `GET /api/messages/active` — returns real data from the database, supports `?channel=`, `?route=`, `?zone=` filters
- `POST /api/messages` — creates a message, correctly rejects unauthenticated requests
- Easy Auth (App Service Authentication v2) on the REST API Function App — anonymous requests still reach public routes; the auth layer itself doesn't break anything (see Section 5 for what this took to get right)
- Front Door routing: `/` → MVTA OnBoard Static Web App, `/api/*` → REST API Function App, confirmed via live curl tests through the actual Front Door endpoint
- `demo_service_alerts.html` (included in the files package) — a real working frontend polling the live API every 30s, tested logic (not yet confirmed against a browser, but the fetch/render logic is sound)

### What EXISTS but has NO CODE yet
- `func-mvta-dispatch-dev` — the Function App is provisioned, but zero application code has been deployed to it. This is where SMS/email sending logic needs to go.
- Rider opt-in Static Web App (`stapp-mvta-riderapp-dev`) — hosting exists, shows Azure's default placeholder page, no app code deployed
- MVTA OnBoard Static Web App (`stapp-mvta-onboard-dev`) — same, placeholder only

### What's NOT provisioned yet
- **Azure Communication Services** — no ACS resource exists. This blocks all SMS/email sending. Needs: a phone number purchased for SMS, a verified sending domain for email, both pulled into Key Vault via `scripts/load-secrets.sh` (already built, just needs real values).
- Power Automate ingestion flow — not built at all (this is a Power Automate portal artifact, not code)
- Front Door WAF — deliberately deferred; Front Door itself has no WAF policy attached yet

### Known deviation from the original Bicep plan
**Front Door was built directly in the Azure Portal, not via Bicep.** The Bicep module (`infra-phase1/modules/frontdoor.bicep`, included in the files package) was attempted repeatedly and hit a persistent, never-resolved error (`"Policy ArmResourceId has incorrect formatting"`) across every configuration variation tried. It's commented out of `main-phase1.bicep`. **Do not re-enable it without expecting to hit the same wall** — if Front Door ever needs to be redeployed or replicated (e.g., for a `test` or `prod` environment), plan on doing it manually in the portal again, following the same steps: create profile (Standard tier) → add origin group + origin for the Static Web App → add origin group + origin for the REST API → add the `/api/*` path-based route → (WAF as a separate later step).

## 4. Code structure (see attached files)

```
functions-restapi/
  package.json, host.json
  local.settings.json.example
  src/
    functions/
      health.js            — GET /api/health (done, working)
      messagesActive.js     — GET /api/messages/active (done, working, includes created_at as of latest fix)
      messagesCreate.js     — POST /api/messages (done, working, requires auth)
    lib/
      db.js                 — SQL connection pooling. IMPORTANT: parses the connection
                               string into discrete config fields rather than passing
                               the raw ADO.NET-style string to sql.connect() - the mssql
                               npm package does not reliably parse the combined
                               "Server=tcp:host,port;..." format. Do not "simplify" this
                               back to a raw string pass-through.
      auth.js                — reads x-ms-client-principal header (Easy Auth), checks
                               app roles. requireRole(request, ['OCC.Publisher', ...])
      validation.js          — input validation matching SQL CHECK constraints
  sql/
    phase1-schema.sql         — full schema, already run against the live database
    migration-001-add-summary-column.sql — only needed for OLD databases; current
                               schema already includes summary. Note the GO batch
                               separators between ALTER TABLE and UPDATE - SQL Server
                               validates the whole batch before running any of it, so
                               referencing a just-added column in the same batch fails
                               without this separator.

infra-stage0/                — Bicep for VNet, Key Vault, SQL, monitoring, private DNS
infra-phase1/                 — Bicep for Function Apps, Static Web Apps, Service Bus
                               (Front Door module present but NOT wired into
                               main-phase1.bicep - see Section 3)
```

### REST API endpoints still needed (per architecture doc Section 9)
Only 3 of ~16 endpoints exist. Still to build:
- `PATCH /messages/{id}` — edit/retract expiration
- `POST /messages/{id}/retract`
- `GET /admin/expiration-defaults`, `PATCH /admin/expiration-defaults/{category}`
- `POST /subscribers` — rider opt-in (**needed for the SMS/email POC priority**)
- `POST /subscribers/{id}/confirm` — SMS double opt-in confirmation
- `GET /subscribers/{id}/confirm-email` — email confirmation link handler
- `POST /subscribers/{id}/request-code`, `PATCH /subscribers/{id}` — preference changes with OTP
- `POST /subscribers/webhook/inbound-sms` — STOP/HELP handling
- `POST /subscribers/{id}/device-token`, `DELETE .../device-token/{id}` — push (Phase 2, lower priority right now)
- `GET /admin/messages?tag=` — tag search
- `GET /suggested-alerts?status=pending`, `POST /suggested-alerts/{id}/approve`, `.../dismiss` — the human-review queue for predictive alerts (Phase 3, but keep the human-in-the-loop design principle in mind even when just planning this)
- `POST /webhooks/sparelabs` — Zona wait-time webhook (Phase 3)

**For the current SMS/email priority, the critical path is**: `POST /subscribers`, the confirmation endpoints, and the dispatch handler's actual send logic (currently nonexistent).

## 5. Hard-won lessons (read before touching Bicep or Azure config)

These cost real debugging time. Don't rediscover them the hard way:

1. **Bicep's inline `appSettings` list is the *complete* desired state for a Function App**, not additive. Any setting set manually via `az functionapp config appsettings set` outside what's declared in Bicep gets silently wiped on the next Bicep redeploy. This bit us twice — once for `SQL_CONNECTION_STRING` (now fixed: it's a proper Key Vault reference declared in Bicep) and once for `WEBSITE_RUN_FROM_PACKAGE` (now explicitly declared too). If you add any new app setting by hand for testing, also add it to the Bicep or expect it to vanish.

2. **Removing a resource from a Bicep template does NOT delete or disable it on Azure** (Incremental deployment mode just stops managing it — the resource stays exactly as it was). We learned this when commenting out Easy Auth's Bicep block didn't actually turn it off; had to use `az webapp auth update --enabled false` (or the portal) explicitly.

3. **Easy Auth (`authsettingsV2`) needs `platform: { enabled: true }` explicitly declared.** Without it, we got the whole Function App returning 404 on every route — including ones with zero dependencies — instead of just gating the one route that needed auth. Also use API version `2022-03-01` for this specific config resource, not the same version as the parent `Microsoft.Web/sites` resource.

4. **After significant Bicep/infra changes to a Function App, a fresh `func azure functionapp publish --force` may be needed** even after the config itself is fixed — we saw the app stay broken after fixing Easy Auth's config until we did a clean code redeploy. Don't assume "config is fixed" means "app is recovered."

5. **Storage account names can't contain hyphens.** `uniqueSuffix` (e.g., `mvta-jx4471`) has one — strip it with `replace(uniqueSuffix, '-', '')` when building storage account names specifically. Key Vault and SQL Server names are fine with the hyphen intact.

6. **The `mssql` npm package doesn't reliably parse combined `Server=tcp:host,port;...` connection strings.** `db.js` parses into discrete fields (`server`, `port`, `database`, `user`, `password`, `options`) before calling `sql.connect()`. A direct `sqlcmd` connection with identical credentials worked fine while the Node code failed with `ELOGIN` — that was the tell.

7. **SQL Server public access is disabled by design** (private endpoint only). For any one-off `sqlcmd`/manual DB work, you'll need to temporarily re-enable public access + add a firewall rule for your IP, then close both back down afterward. Don't leave this open.

8. **When a Key Vault gets deleted, it goes into a 90-day "soft delete" state** and its name stays reserved. If you need to reuse a name, `az keyvault purge --name X --location <original-region>` first — note the location must be where it *used to* live, not necessarily current deployment target.

## 6. Division of labor going forward

- **Claude Code**: writing and testing the remaining endpoints, the dispatch handler's SMS/email logic, the Power Automate flow guidance, general implementation work
- **Claude (chat, separate conversation)**: continues as UX/UI advisor and infrastructure planning partner for the project owner

## 7. Frontend design references — note on this package

Only `demo_service_alerts.html` (the working, live-data-wired frontend) is included in this file package. Earlier design mockups exist for the MVTA OnBoard staff dashboard, the rider opt-in page, and an audit-log tag-search view — these were built as static HTML/CSS design references in the Claude chat conversation but are not re-included here. **Ask the project owner for these specifically if you need the visual design reference while building the OnBoard dashboard or rider opt-in page** — they contain the agreed-upon look and feel (an internal ops-tool aesthetic for OnBoard, matching MVTA.com's public branding for rider-facing pages) that should be matched, not redesigned from scratch.

## 8. Immediate next steps (in order)

1. Provision Azure Communication Services (phone number + verified email domain) — portal work, real cost, not code
2. Run `scripts/load-secrets.sh` once real ACS + Claude API credentials exist
3. Build `POST /subscribers` and the SMS/email confirmation endpoints
4. Build the dispatch handler's actual send logic (SMS via ACS, email via ACS Email)
5. Wire `POST /messages` (and the retract endpoint, once built) to publish to the Service Bus queue on create/update, so the dispatch handler actually gets triggered
6. Wire the rider opt-in mockup to the new endpoints
7. End-to-end test: opt in with a real phone/email → post an announcement in OnBoard → confirm a real SMS/email arrives
