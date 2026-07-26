# MVTA OnBoard — Current State

**Last reviewed:** July 26, 2026  
**Repository version:** Onboard Console 1.1.0  
**Environment:** `dev` is the only live Azure environment and is effectively production.

This document is the current repository-level source of truth for what has
been built, what is known to be live, and what remains incomplete. It
supersedes the implementation-status and next-step sections of `HANDOFF.md`,
which describe an earlier stage of the project.

> The codebase and local builds were reviewed on July 25, 2026. Live Azure
> resources were not queried during that review. Items described as live or
> deployed below are based on the repository's changelog and existing project
> documentation unless explicitly noted otherwise.

## 1. Product summary

MVTA OnBoard is a transit service-alert platform for Minnesota Valley Transit
Authority. It includes:

- A public rider application for active service alerts and notification opt-in.
- An Entra-authenticated staff console for composing and managing alerts.
- OCC tools for event monitoring, decision support, OTP compliance, live
  delays, and speed monitoring.
- A REST API backed by Azure SQL.
- GTFS static and GTFS-Realtime ingestion for alerts, trip delays, and vehicle
  positions.
- A human-review queue for automatically detected or externally sourced alert
  suggestions.
- A Service Bus-driven dispatch application intended to send SMS and email
  through Azure Communication Services.

Automated detection never publishes directly to riders. A publisher or
administrator must approve a suggested alert before it becomes an active
message.

## 2. Repository structure

```text
frontend/
  packages/shared/             Shared types, formatting, design tokens, API client
  packages/rider-app/          Public service-alert and notification opt-in app
  packages/onboard-console/    Staff console and OCC tools

functions-restapi/             Azure Functions REST API and GTFS polling jobs
  src/functions/               HTTP and timer-triggered functions
  src/lib/                     Auth, database, validation, events, GTFS parsing
  sql/                         Base schema and incremental migrations

functions-dispatch/            Service Bus-triggered SMS/email dispatch functions

infra-stage0/                  Network, SQL, Key Vault, and monitoring Bicep
infra-phase1/                  Functions, Static Web Apps, Service Bus, and WAF Bicep
.github/workflows/             Infrastructure, API, and frontend CI/CD
retired-mockups/               Superseded HTML design references
```

## 3. Implemented capabilities

### Rider application

- Displays active service alerts from `GET /api/messages/active`.
- Supports channel, route, and zone filters through the shared API client.
- Provides a public notification opt-in form.
- Allows SMS, email, or both contact methods.
- Allows riders to select alert categories.
- Currently subscribes riders to all routes and all zones.
- Creates pending subscriptions through `POST /api/subscribers`.

### Staff console

- Entra ID authentication using MSAL.
- Development-only mock authentication mode for local UI work.
- Role-aware navigation and controls for:
  - `OCC.Viewer`
  - `OCC.Publisher`
  - `OCC.Admin`
  - `System.Ingestion` on the API
- Dashboard and active-message management.
- Message composition.
- Message summary/expiration editing.
- Message retraction.
- Audit-log search.
- Subscriber summary.
- Expiration-default administration.
- Suggested-alert approval and dismissal.
- OCC tools:
  - Event Monitoring
  - Decision Matrix
  - OTP Compliance
  - Live Delays
  - Speed Alerts

Some OCC modules still use static or mock datasets. Live Delays and Speed
Alerts are backed by the GTFS monitoring tables, while Event Monitoring,
Decision Matrix, and OTP Compliance are not fully connected to production data
sources.

### REST API

Implemented HTTP endpoints include:

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health check |
| `GET` | `/api/messages/active` | Public | Active rider-facing alerts |
| `POST` | `/api/messages` | Publisher/Admin/Ingestion | Create and publish an alert |
| `PATCH` | `/api/messages/{id}` | Publisher/Admin | Edit summary or expiration |
| `POST` | `/api/messages/{id}/retract` | Publisher/Admin | Retract an active alert |
| `POST` | `/api/subscribers` | Public | Create a pending rider subscription |
| `GET` | `/api/admin/messages` | Staff | Search message history |
| `GET` | `/api/admin/expiration-defaults` | Staff | List expiration defaults |
| `PATCH` | `/api/admin/expiration-defaults/{category}` | Admin | Update an expiration default |
| `GET` | `/api/admin/subscribers/summary` | Admin | View masked subscriber statistics |
| `GET` | `/api/suggested-alerts` | Staff | List suggested alerts |
| `POST` | `/api/suggested-alerts/{id}/approve` | Publisher/Admin | Approve and publish a suggestion |
| `POST` | `/api/suggested-alerts/{id}/dismiss` | Publisher/Admin | Dismiss a suggestion |
| `GET` | `/api/trip-delays` | Staff | Read current and predicted fixed-route departure risk |
| `GET` | `/api/on-demand-risks` | Staff | Read active on-demand wait-risk records |

Authorization is enforced server-side by reading the Easy Auth
`x-ms-client-principal` header and checking Entra application roles.

### GTFS integrations

- GTFS-Realtime Alert polling creates deduplicated Suggested Alerts for
  dispatcher-entered notices.
- GTFS-Realtime TripUpdate polling runs every five minutes.
- All mapped trip departure deviations are recorded in
  `MonitoredTripDelays`.
- Every usable future StopTimeUpdate is retained as a departure prediction.
- The poller calculates the maximum future departure delay and first stop
  predicted to cross the 15-minute threshold.
- A predicted departure delay over 15 minutes across two consecutive polls is
  escalated to the human-review queue.
- Suggested Alert deduplication includes the service date so a recurring
  scheduled trip can create a new exception on a later service day.
- GTFS-Realtime VehiclePosition polling stores latitude, longitude, bearing,
  speed, occupancy, and current vehicle status.
- Daily static GTFS synchronization stores stop names and trip-direction
  reference data.
- Direction labels are derived from `trips.txt` headsigns.
- Previous-stop tracking is derived when a trip's next stop changes.

### Dispatch application

- Consumes message-created events from the `message-created-events` Service
  Bus queue.
- Finds confirmed subscribers by category and route preference.
- Sends SMS and email through Azure Communication Services when configured.
- Writes SMS and email delivery attempts to the delivery-log tables.
- Consumes confirmation-requested events from the
  `confirmation-requested-events` queue.
- Sends SMS confirmation codes and email confirmation links.
- Safely no-ops when ACS settings are absent.

## 4. Database state

The database is defined by the base schema plus incremental migrations:

| Script | Adds |
| --- | --- |
| `phase1-schema.sql` | Messages, expiration defaults, subscribers, delivery logs |
| `migration-002-subscriber-confirmations.sql` | Per-channel confirmation tokens |
| `migration-003-suggested-alerts.sql` | Human-review Suggested Alerts queue |
| `migration-004-suggested-alerts-external-id.sql` | Feed deduplication identifier |
| `migration-005-trip-delays.sql` | Monitored trip delays and GTFS stops |
| `migration-006-vehicle-positions.sql` | Vehicle position and occupancy columns |
| `migration-007-trip-directions-and-previous-stop.sql` | Direction reference data and previous stop |
| `migration-008-departure-risk-predictions.sql` | Future departure predictions, threshold crossing, and confidence |
| `migration-009-on-demand-wait-risks.sql` | Vendor-neutral on-demand wait-risk monitoring contract |

The migration scripts are manual, one-time SQL scripts. There is currently no
automated migration runner or schema-version table. A new environment must run
the base schema and applicable migrations in order before deploying code that
depends on the newer tables and columns.

## 5. CI/CD and local verification

Pushes to `main` can deploy:

- Infrastructure through `.github/workflows/infra.yml`.
- Both Function Apps through `.github/workflows/api.yml`.
- Both frontend applications through `.github/workflows/frontend.yml`.

Azure authentication in GitHub Actions uses OIDC. Static Web App deployment
uses deployment-token secrets.

Local verification performed July 26, 2026:

- REST API TypeScript build: passed.
- REST API unit tests: **67 passed, 0 failed**.
- Dispatch TypeScript build: passed.
- Shared frontend package build: passed.
- Rider application production build: passed.
- Staff console production build and wrapping step: passed.

The staff console build reports a bundle-size warning for a JavaScript chunk of
approximately 562 KB. Its authentication-related dynamic imports also do not
currently produce separate chunks because the same modules are statically
imported elsewhere.

OCC Tools now includes integration-ready Fixed Route Risk and On-Demand
Quality screens. Fixed-route predictions use live TripUpdate records after
migration 008 is applied. On-demand records require a vendor adapter to
populate migration 009's table. Both screens use clearly labeled review
scenarios when their authenticated data source is unavailable.

The dispatch project's test command is currently a placeholder and executes no
tests. CI does not currently perform a database, Service Bus, Azure
Communication Services, authentication, or end-to-end delivery test.

## 6. Known live-environment issue

The changelog records that the live REST Function App does not yet have the
Easy Auth `allowedAudiences` fix that is present in Bicep. Until the
infrastructure is redeployed or the live setting is corrected directly,
authenticated console calls may receive `Not authenticated`.

This issue was not independently checked against Azure during the July 25
repository review.

## 7. Critical incomplete work and risks

### 7.1 Function App settings are incomplete in Bicep

The Function App module declares its inline `appSettings` collection as the
complete desired state, but it does not currently declare several settings
used by the applications:

- `SERVICE_BUS_NAMESPACE`
- `ServiceBusConnection__fullyQualifiedNamespace` or the equivalent
  identity-based Service Bus trigger connection
- `SERVICE_BUS_QUEUE`
- `SERVICE_BUS_CONFIRM_QUEUE`
- `ACS_ENDPOINT`
- `ACS_SMS_FROM`
- `ACS_EMAIL_FROM`
- `RIDER_APP_BASE_URL`
- `GTFS_RT_ALERT_URL`
- `GTFS_RT_TRIPUPDATE_URL`
- `GTFS_RT_VEHICLE_URL`
- `GTFS_STATIC_URL`

An infrastructure deployment can therefore erase manually added values. The
REST API then skips event publication, GTFS jobs skip their polls, and the
dispatch Function App may be unable to bind its Service Bus triggers.

App-specific settings should be parameters or separate configuration blocks;
the REST and dispatch applications should not receive an identical settings
list.

### 7.2 Double opt-in cannot be completed

Subscription creation and confirmation-message delivery are implemented, but
the callback endpoints are not:

- SMS confirmation-code submission.
- Email confirmation-link handling.
- Confirmation-code resend.
- Inbound SMS processing.
- `STOP` opt-out handling.
- `HELP` response handling.

The email sender currently generates a link to
`/api/subscribers/confirm-email`, but no matching REST function exists. The SMS
message tells the rider to reply with the code, but no inbound webhook exists.
New subscribers therefore remain `pending_confirmation`.

Azure Communication Services provisioning is required to send real
confirmations, but it does not prevent the callback endpoints and their tests
from being implemented now.

### 7.3 Dispatch targeting is incomplete

Broadcast dispatch currently evaluates category and route preferences, but it
does not evaluate:

- The subscriber's zone preferences.
- The alert's affected zones.
- The alert's requested delivery channels.

As written, a message restricted to SMS or email can still be sent over both
available channels, and a zone-specific alert can reach confirmed subscribers
outside the affected zone.

### 7.4 Event publication has no durable retry path

Message and subscriber records are committed before their Service Bus events
are published. Publication is best-effort and a publish failure does not fail
the originating request.

There is no transactional outbox, replay job, or administrative resend
operation. A temporary Service Bus failure can therefore leave:

- An active web alert that was never dispatched by SMS/email.
- A pending subscriber who never received a confirmation.

### 7.5 GTFS delay deduplication may outlive a service day

GTFS delay suggestions use the realtime `trip_id` as their external identifier.
The database permanently enforces uniqueness on `(source, external_id)`.

If MVTA reuses scheduled trip IDs across service days, a trip can create only
one delay suggestion for the lifetime of the Suggested Alerts table. Later
delays for the same trip ID will hit the uniqueness constraint. A durable key
should distinguish feed type and service instance, for example:

```text
trip_update:{service_date}:{trip_id}
```

Alert-feed entity IDs and TripUpdate trip IDs should also occupy separate
external-ID namespaces.

### 7.6 Subscriber duplication is not prevented

Phone and email indexes are non-unique. Repeated opt-ins can create multiple
subscriber records for the same contact method. Once confirmation is
implemented, this can lead to duplicate notifications unless subscription
creation merges, reactivates, or explicitly rejects existing contacts.

## 8. Security posture

Implemented controls include:

- Entra ID authentication for staff.
- Server-side role checks.
- Managed identities for Azure resource access.
- Key Vault references for the SQL connection string.
- Service Bus local authentication disabled.
- TLS-only Function Apps.
- Restricted frontend security headers and CSP.
- Parameterized SQL queries.
- Front Door-only Function App ingress when a Front Door ID is supplied.
- Human approval before detected alerts are published.
- HTML escaping for email alert content.

Outstanding security and compliance work includes:

- Completing double opt-in confirmation.
- Implementing and testing `STOP` and `HELP`.
- Verifying that the live Easy Auth audience configuration is correct.
- Ensuring Front Door-only ingress is enabled in the live parameters.
- Adding abuse controls/rate limiting for public subscription operations.
- Considering hashed confirmation tokens rather than storing reusable tokens
  in plaintext.
- Defining retention and deletion policies for subscriber PII and delivery
  logs.

## 9. Recommended next actions

1. Split REST and dispatch Function App settings in Bicep and declare every
   required Service Bus, GTFS, ACS, and rider-app setting.
2. Deploy the Easy Auth audience fix and verify an authenticated console read
   and write through Front Door.
3. Implement email confirmation, SMS confirmation, resend, inbound SMS,
   `STOP`, and `HELP`.
4. Make dispatch honor category, route, zone, and channel preferences.
5. Add dispatch unit tests and an integration test covering message creation,
   queue delivery, audience selection, and delivery logging.
6. Introduce a transactional outbox or another replayable event-publication
   mechanism.
7. Correct GTFS delay external IDs to include feed type and service instance.
8. Add an automated, versioned database migration process.
9. Update or archive stale implementation sections in `HANDOFF.md` and keep
   this document current after material releases.

## 10. Definition of a complete SMS/email proof of concept

The core proof of concept is complete when the following flow is repeatable:

1. A rider submits a real phone number and/or email address.
2. A confirmation is delivered.
3. The rider confirms each requested channel.
4. The database records the confirmed channel state.
5. An authorized staff member publishes an alert.
6. The message-created event is durably queued.
7. Only subscribers matching category, route, zone, and channel preferences
   receive the alert.
8. SMS/email delivery attempts and provider IDs are recorded.
9. A rider can send `STOP` and is excluded from subsequent dispatches.
10. The full path is covered by automated tests and a live-environment smoke
    test.
