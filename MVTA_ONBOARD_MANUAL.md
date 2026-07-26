# MVTA OnBoard — Consolidated Manual

**Last updated:** July 26, 2026  
**Audience:** OCC leadership, control center staff, product owners, developers,
and implementation partners  
**Status:** Current repository-level source of truth

This manual consolidates the operational, product, technical, deployment, and
roadmap material previously spread across `README.md`, `HANDOFF.md`,
`CURRENT_STATE.md`, `FEATURE_IMPLEMENTATION_HANDOFF.md`, `ROADMAP.md`, and
`SUGGESTED_IMPROVEMENTS.md`. `CHANGELOG.md` remains the release history.

Where older documents conflict with this manual, use this manual and the
current code.

## 1. Purpose

MVTA OnBoard is a companion to MVTA's CAD/AVL platforms. It fills monitoring,
decision-support, compliance, and customer-communication gaps without
replacing the source operational systems.

Its primary operating goals are:

1. Predict fixed-route departures that will be more than 15 minutes late.
2. Identify on-demand customers whose total wait will exceed 25 minutes.
3. Give OCC staff enough advance warning and evidence to intervene.
4. Prepare customer communications for human review.
5. Publish approved messages across configured digital channels.
6. Monitor recovery and support alert closure.
7. Digitize OCC procedures through a governed Decision Matrix.
8. Produce defensible departure-based OTP and contractor reporting.
9. Help OCC investigate credible speeding events.
10. Monitor selected vehicles and service during special events.

Automated detection never publishes directly to riders. An authorized person
must approve a Suggested Alert before it becomes a customer-facing message.

## 2. Service-quality rules

| Service | Operational measure | Poor-service threshold |
| --- | --- | ---: |
| Fixed route | Predicted departure delay | More than 15 minutes late |
| On-demand | Predicted or actual customer wait | More than 25 minutes |

For fixed route, arrival information may support travel-time, dwell, and
vehicle-progress calculations, but the compliance and alert threshold is based
on departure.

For on-demand, the authoritative wait-start event must be agreed with the
operating policy and vendor data contract. The current database and API are
vendor-neutral and intentionally contain no customer PII.

## 3. Human-reviewed alert workflow

```text
Operational source data
        |
        v
Service-risk calculation
        |
        v
Threshold risk and supporting evidence
        |
        v
OCC exception review
        |
        +--> Operational action / monitoring
        |
        `--> Suggested customer alert
                    |
                    v
             Staff review and edit
                    |
                    v
             Approve and publish
                    |
                    v
         Web, SMS, email, and later channels
```

The Fixed Route Risk and On-Demand Quality workspaces now use this workflow:

- A live risk with an existing suggestion opens that suggestion.
- A live risk without a suggestion creates one deduplicated pending draft,
  then opens it in Suggested Alerts.
- Repeated preparation attempts reuse the same pending draft.
- A reviewed draft cannot be silently recreated for the same operational
  event.
- Preview scenarios show the proposed customer language but never save it.
- Publishing still requires the separate **Approve & publish** action.

Acknowledgement and monitoring buttons currently remain local UI state and are
not yet durable Operational Events.

## 4. User applications

### 4.1 Rider application

The public rider application:

- Displays active service alerts.
- Supports route, zone, and channel filters in the API.
- Accepts notification opt-in requests for SMS, email, or both.
- Allows alert-category selection.
- Currently subscribes new riders to all routes and zones.

The full double-opt-in lifecycle is not complete. Confirmation callbacks,
resend, inbound SMS, `STOP`, and `HELP` still require implementation and live
provider verification.

### 4.2 Staff console

The staff console uses Microsoft Entra ID and the following application roles:

| Role | Intended access |
| --- | --- |
| `OCC.Viewer` | Staff read access |
| `OCC.Publisher` | Read, prepare, approve, and publish |
| `OCC.Admin` | Publisher capabilities plus administration and OCC tools |
| `System.Ingestion` | Service-to-service message creation |

Major console areas:

- Dashboard
- Compose
- Active Messages
- Suggested Alerts
- Subscribers
- Audit Log
- Administration
- OCC Tools

OCC Tools currently includes:

- Event Monitoring
- Decision Matrix
- OTP Compliance
- Fixed Route Risk
- On-Demand Quality
- Speed Alerts

Event Monitoring, Decision Matrix, OTP Compliance, and parts of Speed Alerts
still use static or limited datasets. Fixed Route Risk uses GTFS monitoring
data when authenticated. On-Demand Quality becomes live when an approved
vendor adapter populates its monitoring table.

### 4.3 Local preview mode

Local console development defaults to mock authentication. Mock role buttons
are for interface testing only; they do not produce a real Entra access token.
Authenticated API requests therefore fail safely and the risk screens show
clearly marked preview scenarios.

In preview mode:

- No operational data should be interpreted as live.
- Preparing an alert displays a local customer-language preview.
- Nothing is inserted into the database.
- Nothing is sent to Suggested Alerts or riders.
- Refreshing the page clears local workflow state.

Use real MSAL configuration and an approved local redirect URI when
authenticated local testing is required.

## 5. Fixed Route Service Risk

### 5.1 Current calculation

GTFS-Realtime TripUpdate processing:

- Sorts future StopTimeUpdates by stop sequence.
- Prefers `Departure.Delay`.
- Uses `Arrival.Delay` only when departure delay is unavailable.
- Retains every usable future departure prediction.
- Retains absolute predicted departure time when provided.
- Calculates the maximum future departure delay.
- Identifies the first future stop predicted above 15 minutes.
- Retains GTFS service date for event identity.

The polling job runs every five minutes. A trip escalates into Suggested Alerts
after the maximum predicted future departure delay remains above 15 minutes
for two consecutive polls.

The deduplication key is:

```text
delay:{service_date}:{trip_id}
```

This allows recurring scheduled trip IDs to create separate exceptions on
different service days.

### 5.2 Information shown to OCC

- Current departure delay
- Maximum predicted future departure delay
- First affected departure and predicted time
- Time until threshold crossing
- Trend
- Confidence and reasons
- Stop-by-stop departure timeline
- Vehicle and current telemetry context
- Downstream block placeholder when that information exists

### 5.3 Current limitations

- The system primarily uses predictions supplied by the realtime feed.
- Static `stop_times.txt`, service calendars, shapes, and block schedules are
  not yet used for a complete independent prediction model.
- Scheduled times in the detail view may be derived by subtracting delay from
  the supplied predicted time.
- Trend is not yet calculated from an append-only observation history.
- Downstream block and recovery-time prediction is incomplete.
- Missing TripUpdates must never be interpreted as on-time service.

## 6. On-Demand Service Quality

The current contract supports:

- Current elapsed wait
- Predicted total wait and pickup time
- Zone
- Assigned vehicle
- Stops ahead
- Accessible-vehicle requirement
- Eligible vehicles in the zone
- Assignment context
- Trend
- Confidence and reasons
- Linked Suggested Alert

Exception states are:

| State | Meaning |
| --- | --- |
| Normal | Predicted wait of 20 minutes or less |
| Watch | Predicted wait above 20 and no more than 25 minutes |
| Predicted poor service | Predicted wait above 25 minutes |
| Poor service occurring | Actual wait above 25 minutes |
| Recovering | Prediction has returned toward or below the threshold |

`MonitoredOnDemandWaits` is an integration contract, not a vendor connector.
Before building the producer, obtain approved documentation and representative
payloads for authentication, wait-start semantics, pickup windows, assignments,
manifests, accessibility, cancellations, capacity, and source timestamps.

The adapter must exclude names, phone numbers, addresses, and other customer
PII.

## 7. Suggested Alerts and publishing

Suggested Alerts is the human-review queue for:

- Dispatcher-authored GTFS-Realtime notices.
- Sustained fixed-route departure risk.
- On-demand wait risk when the producer is connected.
- OCC-prepared risk drafts.

Available actions:

- Review the proposed customer language.
- Approve and publish.
- Dismiss.

Approval creates a normal `Messages` record, applies the category expiration
default, and publishes the message-created event to the Service Bus path.

The OCC preparation endpoint is:

```text
POST /api/suggested-alerts/prepare
```

It requires Publisher, Admin, or System Ingestion authority and uses
`source + external_id` as its idempotency key. It creates a pending review item
only; it never publishes.

## 8. REST API

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health check |
| `GET` | `/api/messages/active` | Public | Active rider-facing alerts |
| `POST` | `/api/messages` | Publisher/Admin/Ingestion | Create and publish |
| `PATCH` | `/api/messages/{id}` | Publisher/Admin | Edit summary or expiration |
| `POST` | `/api/messages/{id}/retract` | Publisher/Admin | Retract |
| `POST` | `/api/subscribers` | Public | Create pending subscription |
| `GET` | `/api/admin/messages` | Staff | Search message history |
| `GET` | `/api/admin/expiration-defaults` | Staff | List defaults |
| `PATCH` | `/api/admin/expiration-defaults/{category}` | Admin | Update default |
| `GET` | `/api/admin/subscribers/summary` | Admin | Masked statistics |
| `GET` | `/api/suggested-alerts` | Staff | List suggestions |
| `POST` | `/api/suggested-alerts/prepare` | Publisher/Admin/Ingestion | Prepare or reuse draft |
| `POST` | `/api/suggested-alerts/{id}/approve` | Publisher/Admin | Approve and publish |
| `POST` | `/api/suggested-alerts/{id}/dismiss` | Publisher/Admin | Dismiss |
| `GET` | `/api/trip-delays` | Staff | Fixed-route departure risks |
| `GET` | `/api/on-demand-risks` | Staff | On-demand wait risks |

Staff authorization is enforced server-side using the Easy Auth
`x-ms-client-principal` header. Client-side role checks improve the interface
but are not the security boundary.

## 9. Data model and migrations

Apply the base schema and migrations in order:

| Script | Purpose |
| --- | --- |
| `phase1-schema.sql` | Messages, defaults, subscribers, delivery logs |
| `migration-002-subscriber-confirmations.sql` | Channel confirmations |
| `migration-003-suggested-alerts.sql` | Human-review queue |
| `migration-004-suggested-alerts-external-id.sql` | Feed deduplication |
| `migration-005-trip-delays.sql` | Trip monitoring and GTFS stops |
| `migration-006-vehicle-positions.sql` | Vehicle telemetry |
| `migration-007-trip-directions-and-previous-stop.sql` | Directions and previous stops |
| `migration-008-departure-risk-predictions.sql` | Future departure risk |
| `migration-009-on-demand-wait-risks.sql` | On-demand wait contract |

Migrations 008 and 009 were reported applied by the project owner on
July 26, 2026.

There is no automated migration runner or schema-version table. Never deploy
code that writes new columns before the corresponding migration succeeds.

SQL public access is disabled by design. Any temporary public-access procedure
must use a narrow firewall rule and be reversed immediately after the work.

## 10. Dispatch and customer channels

The dispatch application:

- Consumes message-created Service Bus events.
- Selects confirmed subscribers.
- Calls Azure Communication Services for configured SMS and email channels.
- Records delivery attempts and provider identifiers.
- Safely no-ops when provider settings are absent.

Known gaps:

- Live ACS resource and sender configuration have not been reconfirmed.
- Confirmation callback endpoints are incomplete.
- Inbound SMS `STOP` and `HELP` are incomplete.
- Zone preference and requested-channel targeting require verification and
  completion.
- Event publication is best-effort after the database commit; there is no
  transactional outbox or replay workflow.
- Subscriber contacts are not protected by a complete deduplication policy.

## 11. Infrastructure and environments

`dev` is the only documented live environment and must be treated as
production-like.

Documented Azure resources are in West US 2 under:

```text
Resource group:       rg-mvta-onboard-dev
Key Vault:            kv-mvta-dev-mvta-jx4471
SQL server:           sql-mvta-dev-mvta-jx4471.database.windows.net
SQL database:         sqldb-mvta-onboard-dev
REST Function App:    func-mvta-restapi-dev
Dispatch Function:    func-mvta-dispatch-dev
Staff Static Web App: stapp-mvta-onboard-dev
Rider Static Web App: stapp-mvta-riderapp-dev
Service Bus:          sb-mvta-onboard-dev
Front Door:           endpoint-mvta-onboard-dev-haehgsbbe6esd8cc.z03.azurefd.net
```

Front Door was originally created manually after the Bicep module failed.
WAF code exists, but live policy attachment and ingress restrictions should be
verified before representing them as active controls.

Important infrastructure rules:

1. Inline Function App `appSettings` in Bicep are the complete desired state.
   A later deployment can remove settings added manually.
2. Removing a resource from an incremental Bicep template does not delete the
   live resource.
3. Easy Auth requires its platform to be explicitly enabled.
4. Significant Function App configuration changes may require a fresh code
   deployment.
5. Storage account names cannot contain hyphens.
6. Keep the existing parsed `mssql` connection configuration; do not replace
   it with an unverified raw ADO.NET connection string.
7. Soft-deleted Key Vault names remain reserved until purged.

The live Easy Auth audience configuration still needs a real signed-in smoke
test. Anonymous requests correctly receive `401` on staff-only routes; that
alone does not prove a signed-in access token is accepted.

## 12. Configuration

Settings used across the applications include:

```text
SQL_CONNECTION_STRING
SERVICE_BUS_NAMESPACE
ServiceBusConnection__fullyQualifiedNamespace
SERVICE_BUS_QUEUE
SERVICE_BUS_CONFIRM_QUEUE
ACS_ENDPOINT
ACS_SMS_FROM
ACS_EMAIL_FROM
RIDER_APP_BASE_URL
GTFS_RT_ALERT_URL
GTFS_RT_TRIPUPDATE_URL
GTFS_RT_VEHICLE_URL
GTFS_STATIC_URL
```

Declare durable settings in infrastructure code or the approved environment
configuration. Do not rely on temporary portal values that a deployment can
erase.

## 13. Repository layout

```text
frontend/
  packages/shared/             Shared types and API client
  packages/rider-app/          Public rider application
  packages/onboard-console/    Staff console and OCC tools

functions-restapi/             HTTP and GTFS polling Functions
functions-dispatch/            Service Bus dispatch Functions
infra-stage0/                  Network, SQL, Key Vault, monitoring
infra-phase1/                  Functions, SWAs, Service Bus, WAF definition
.github/workflows/             CI/CD
retired-mockups/               Superseded design references
```

## 14. Local development and verification

```bash
# Frontend
cd frontend
npm install
npm run dev:rider
npm run dev:console
npm run build

# REST API
cd functions-restapi
npm install
npm test
npm start
```

Copy example environment files to local ignored files and provide approved
values. Never commit secrets.

Current automated coverage:

- REST API TypeScript build and unit tests.
- Shared package and both frontend production builds.
- API and frontend build checks in GitHub Actions.

Important gaps:

- Dispatch test command remains a placeholder.
- There is no database integration test.
- There is no authenticated browser smoke test in CI.
- There is no end-to-end SMS/email delivery test.
- The console bundle currently produces a size warning.

## 15. Deployment

Pushes to `main` trigger path-filtered GitHub Actions:

- `.github/workflows/api.yml` deploys the REST and dispatch Function Apps.
- `.github/workflows/frontend.yml` deploys the rider and console apps.
- `.github/workflows/infra.yml` deploys infrastructure when its paths change.

Azure deployment authentication uses GitHub OIDC. Static Web App workflows use
their configured deployment tokens.

Recommended release sequence:

1. Apply required database migrations.
2. Run local API tests and frontend builds.
3. Review the diff for secrets and accidental environment files.
4. Push to `main`.
5. Confirm workflow completion.
6. Verify `/api/health`.
7. Verify the new or changed authenticated route with a real Entra sign-in.
8. Verify the public console and rider bundles.
9. Record the change in `CHANGELOG.md`.

## 16. Security and compliance

Implemented controls include:

- Entra ID authentication for staff.
- Server-side application-role enforcement.
- Parameterized SQL.
- Key Vault references.
- Managed identities for supported Azure access.
- TLS-only Functions.
- Frontend security headers and CSP.
- Human approval before automated alerts publish.
- PII-free operational risk responses.

Outstanding requirements:

- Complete and test double opt-in.
- Implement `STOP` and `HELP`.
- Verify Easy Auth audience and Front Door-only ingress.
- Add abuse controls to public subscription routes.
- Define PII and delivery-log retention.
- Consider hashing confirmation tokens.
- Add durable event publication and replay.

## 17. OCC procedure and compliance direction

### Decision Matrix

The Decision Matrix should become a versioned procedure system. Each procedure
should define criteria, immediate actions, notifications, escalation,
communication guidance, follow-up, owner, effective date, approval, and
revision history.

Raised exceptions should surface the relevant procedure automatically.
Controllers should be able to acknowledge, record completed steps, add notes,
assign ownership, escalate, prepare communication, and close with a resolution
code. The Operational Event must retain the procedure version used.

### OTP and contractor scorecards

OTP must use observed versus scheduled departures at governed measurement
points. The on-time window must be configurable by contract, service, route,
and reporting period.

Reports must preserve:

1. Raw OTP before extraordinary-event exclusions.
2. Adjusted contract OTP after approved exclusions.
3. Every excluded observation with reason and approval.

Weather, closures, police/fire activity, approved detours, special events,
outages, and verified bad telemetry may be modeled as governed exclusions.
Exclusions must never overwrite or delete source observations.

Contractor scorecards should include raw and adjusted OTP, early/late
departures, missed and canceled trips, data completeness, exclusion rate,
route/time breakdowns, target variance, and drill-through evidence.

## 18. Safety and special-event direction

### Speed monitoring

A single GPS speed is not proof of speeding. A credible event should consider
reported speed, position-derived speed, timestamp freshness, persistence,
shape adherence, road context, congestion, and agreement between signals.

Recommended sequence:

1. Retain GTFS-Realtime congestion level.
2. Calculate speed from consecutive position fixes.
3. Suppress isolated spikes and impossible acceleration.
4. Add road speed-limit or MnDOT traffic context.
5. Link credible events to the relevant OCC procedure.

The system supports investigation and documentation; it must not automatically
make a disciplinary determination.

### Special-event monitoring

An event workspace should support temporary vehicle, route, block, checkpoint,
headway, and geofence watchlists. It should identify missing service, stale
telemetry, service gaps, bunching, late or early departures, extended dwell,
and capacity concerns using event-specific thresholds.

A post-event report should compare planned and operated service and retain
alerts, incidents, controller actions, and data gaps.

## 19. Application maintenance

### 19.1 Maintenance ownership

Assign named owners for:

| Area | Primary responsibility |
| --- | --- |
| Product and operating policy | Thresholds, workflows, terminology, and priorities |
| OCC procedures | Decision Matrix content, approvals, and revision schedule |
| Application | Frontend, API, integrations, testing, and releases |
| Data | GTFS quality, on-demand contract, retention, and reporting definitions |
| Azure platform | Identity, networking, secrets, monitoring, cost, and recovery |
| Communications | Templates, channels, accessibility, and customer language |
| Compliance | OTP rules, exclusions, approvals, and contractor scorecards |

Do not allow an AI assistant, vendor, or developer to change an operating
threshold or compliance rule solely because it appears technically convenient.
Product and operating-policy owners approve those decisions.

### 19.2 Recommended maintenance cadence

**Each operating day**

- Check API, GTFS, Service Bus, database, and dispatch health.
- Review stale feeds, missing vehicles, failed deliveries, and unreviewed
  Suggested Alerts.
- Confirm that preview data is never being treated as live data.

**Each week**

- Review application and Function logs.
- Review failed or repeatedly retried integrations.
- Check prediction false positives, missed events, and data gaps.
- Review open security, dependency, and operational issues.
- Confirm that temporary firewall rules and test settings were removed.

**Each month**

- Review Azure cost, capacity, role assignments, Key Vault access, and expiring
  credentials or certificates.
- Test a representative fixed-route alert from detection through review.
- Test an on-demand scenario when its producer is connected.
- Review delivery success and subscriber suppression.
- Reconcile documentation with the deployed release.

**Each quarter**

- Run a recovery and rollback exercise.
- Review retention, PII handling, and audit access.
- Review OCC procedures and OTP exclusion rules with their owners.
- Reassess prediction thresholds and confidence using measured outcomes.
- Remove obsolete feature flags, preview paths, and stale documentation.

### 19.3 Source-of-truth order

When documentation conflicts, use this order:

1. Approved operating and contract policy.
2. The deployed database schema and application behavior.
3. This consolidated manual.
4. `CHANGELOG.md`.
5. Current source code and automated tests for implementation detail.
6. `CURRENT_STATE.md` and `FEATURE_IMPLEMENTATION_HANDOFF.md`.
7. Historical planning documents such as `HANDOFF.md` and
   `SUGGESTED_IMPROVEMENTS.md`.

The code is not automatically the authority for policy. A hard-coded value can
be a defect even when the tests confirm it.

### 19.4 Change and release procedure

For every material change:

1. State the operational problem and acceptance criteria.
2. Identify whether the change affects policy, customer communication,
   security, PII, database schema, infrastructure, or deployment.
3. Inspect the current implementation and working tree before editing.
4. Preserve unrelated work.
5. Add or update tests for changed behavior.
6. Apply database migrations before deploying dependent code.
7. Build the API, dispatch application, shared package, rider app, and console
   in proportion to the change.
8. Review the final diff for secrets, accidental environment files, mock data,
   and unintended scope.
9. Update this manual and `CHANGELOG.md`.
10. Deploy through the approved Git workflow.
11. Verify health plus the changed route or screen.
12. For authenticated changes, complete a real Entra smoke test; an anonymous
    `401` proves protection but not successful staff access.
13. Record the release, known limitations, and rollback point.

Prefer a feature branch and reviewed pull request for normal work. Direct
updates to `main` should be limited to explicitly authorized work because
`main` triggers the development deployment workflows.

### 19.5 Maintaining the database

- Treat migrations as immutable once applied.
- Add a new numbered migration instead of editing an applied migration.
- Test migrations against a representative nonproduction copy when possible.
- Back up or confirm point-in-time recovery before destructive schema work.
- Deploy schema before code that reads or writes the new fields.
- Record when and where each migration was applied.
- Add a schema-version table and automated migration runner as a priority.
- Never leave SQL public network access enabled after maintenance.

### 19.6 Maintaining integrations

For every external source, document:

- Owner and support contact.
- Authentication and secret location.
- Endpoint and expected update frequency.
- Payload version and representative redacted sample.
- Timestamp and timezone semantics.
- Retry, timeout, deduplication, and stale-data behavior.
- PII classification.
- Monitoring and failure alert.
- Safe degraded behavior.

Missing or stale data must become an explicit unknown or degraded state. It
must not silently become “on time,” “normal,” or “no issue.”

### 19.7 Using Claude and Codex

Claude and Codex can both help maintain MVTA OnBoard. A useful working
separation is:

- **Claude:** product critique, OCC workflow review, customer-language review,
  procedure drafting, policy questions, option comparison, and design
  discussion.
- **Codex:** repository inspection, implementation, tests, migrations,
  documentation updates, Git work, deployment checks, and evidence-backed
  diagnosis.

This is a working convention, not a technical restriction. Either assistant
can review the other's output. For higher-risk changes, use one to implement
and the other to challenge assumptions, test acceptance criteria, and look for
operational consequences.

Before asking either assistant to work, provide:

- The goal and who will use the result.
- Whether the request is review, diagnosis, implementation, or deployment.
- The applicable departure or wait-time rule.
- The environment in scope.
- Whether database migrations are already applied.
- Files, screenshots, errors, or examples that define the current problem.
- Actions the assistant may take, such as editing, committing, or deploying.
- Any deadline or change-freeze constraint.

Ask the assistant to read this manual, inspect the current code, and verify
facts rather than relying on an older chat summary.

### 19.8 AI safety and review rules

When using Claude, Codex, or another AI tool:

- Do not paste passwords, connection strings, access tokens, private keys,
  confirmation codes, or unredacted customer PII into a prompt.
- Use synthetic or redacted operational examples whenever possible.
- Never allow generated code to bypass Entra roles, human alert approval,
  double opt-in, audit logging, or governed OTP exclusions.
- Require parameterized SQL and server-side authorization.
- Verify generated customer messages for accuracy, accessibility, affected
  audience, channels, and expiration.
- Treat AI-generated SQL migrations and infrastructure changes as high risk.
- Review external packages, licenses, and network dependencies before adding
  them.
- Require evidence for “fixed,” “tested,” “deployed,” and “live.”
- Keep final operational and publication decisions with authorized staff.

An assistant may identify a likely issue from sample data, but it must not make
a disciplinary conclusion about an operator or contractor.

### 19.9 Reusable prompts

**Repository review**

```text
Read MVTA_ONBOARD_MANUAL.md, CHANGELOG.md, and the relevant source files.
Review the current implementation for [area]. Do not edit anything. Report
confirmed behavior, risks, stale documentation, and prioritized next actions.
Distinguish repository evidence from assumptions about the live environment.
```

**Implementation**

```text
Read MVTA_ONBOARD_MANUAL.md first. Implement [change] while preserving these
rules: fixed-route performance uses departures; the threshold is more than
15 minutes; on-demand poor service is more than 25 minutes; automated
detections require human approval. Add tests, update the manual and changelog,
and show validation results. Do not deploy until authorized.
```

**Release**

```text
Review the pending diff and confirm the database prerequisites. Run the
relevant tests and production builds, check for secrets and unrelated changes,
then deploy through the approved Git workflow. Verify health, the changed
public surface, and any authenticated behavior that can be tested. Report the
commit, deployment result, limitations, and rollback point.
```

**Claude product review**

```text
Using MVTA_ONBOARD_MANUAL.md as the current source of truth, review this
feature from an OCC and customer-communication perspective. Check terminology,
decision points, evidence, accessibility, human approval, and possible
unintended operational consequences. Do not assume proposed roadmap items are
already implemented.
```

### 19.10 AI handoff format

When transferring work between Claude, Codex, or a human maintainer, include:

- Objective and user-facing outcome.
- Current branch and last commit.
- Files changed.
- Database migrations and whether they were applied.
- Tests and builds run, with results.
- Deployment status and verified URLs or routes.
- Known limitations and unverified assumptions.
- Exact next action.
- Explicit warning about any temporary access, mock data, or incomplete
  rollback.

Do not use “done” to mean only that code was written. State separately whether
work was implemented, tested, committed, pushed, deployed, and verified.

### 19.11 Incident and rollback procedure

If a release causes an operational issue:

1. Protect customer and staff safety first.
2. Stop further publication or dispatch if incorrect messages could be sent.
3. Record the time, release commit, affected component, and symptoms.
4. Preserve logs and evidence without copying PII into general chat tools.
5. Restore the last known-good application release or disable the affected
   feature using an approved reversible method.
6. Do not reverse an applied database migration destructively unless a tested
   rollback exists.
7. Verify API health, authentication, core public alerts, and dispatch.
8. Document the cause, recovery, and prevention work.

## 20. Product roadmap

### Near term

1. Verify real Entra authentication through Front Door.
2. Connect the approved on-demand data source.
3. Persist acknowledge, monitor, assignment, and closure actions.
4. Import static stop times, calendars, shapes, and blocks.
5. Add append-only prediction observations.
6. Complete confirmation callbacks, `STOP`, and `HELP`.
7. Correct dispatch filtering for route, zone, category, and channel.
8. Add database, authentication, dispatch, and delivery integration tests.

### Next

1. Calculate historical segment travel and dwell baselines.
2. Predict downstream block effects and recovery.
3. Link exceptions to versioned Decision Matrix procedures.
4. Implement governed OTP exclusions and contractor scorecards.
5. Improve speed-event credibility.
6. Add special-event watchlists and reporting.
7. Build route health, headway, bunching, cancellation, and feed-quality
   monitoring.
8. Add a live operations map.

### Later

1. Traffic, weather, closure, and major-event context.
2. Historical operational replay.
3. Alert impact scoring and audience estimates.
4. Direction, stop, zone, severity, channel, time-window, and quiet-hour rider
   preferences.
5. Accessible and multilingual communication variants.
6. Learned prediction models only after the explainable baseline has enough
   clean outcome data for comparison.

## 21. Success measures

Measure:

- Fixed-route threshold events detected in advance.
- On-demand poor waits detected in advance.
- Median warning time.
- False-positive and missed-event rates.
- Prediction error by horizon, route, stop, zone, and time.
- Staff acknowledgement, approval, and dismissal time.
- Time from detection to customer notification.
- Delivery success.
- Time from recovery to alert closure.
- Procedure use and completion.
- Raw and adjusted OTP and exclusion rate.
- Credible speed events and telemetry dismissals.
- Special-event planned versus operated service.

## 22. Immediate completion criteria

The notification proof of concept is operationally complete when a repeatable
test proves:

1. A rider opts in with a real phone number and/or email.
2. Confirmation is delivered and completed.
3. An authorized staff member publishes an alert.
4. The event is durably queued.
5. Only the correct audience and channels receive it.
6. Delivery attempts are recorded.
7. `STOP` prevents later sends.
8. Automated and live smoke tests cover the full path.

The predictive OCC capability is operationally complete when:

1. Live authenticated fixed-route risks are visible.
2. Live on-demand risks are visible.
3. Each prediction is explainable and freshness-aware.
4. OCC actions are persisted.
5. Alert preparation creates one reviewable draft.
6. Approval and publication are auditable.
7. Recovery and closure are linked to the originating condition.
