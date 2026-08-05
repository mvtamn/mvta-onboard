# Changelog

All notable changes to MVTA OnBoard are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions track
`frontend/packages/onboard-console/package.json` (the staff console's `v`
badge and footer read this version at build time - see `vite.config.ts`).

## [Unreleased]

- **OTP Compliance completion**: Audit Stream, Administration, Threshold
  Tuner, and the Dashboard trend chart are now real, replacing their
  "coming soon" placeholders. Review Queue approvals/rejections and Weather
  exclusions are now **persisted** (`OtpStopExclusions`/`OtpDateExclusions`)
  instead of ephemeral browser state that reset on reload - this is also
  what makes the Audit Stream real (it queries these records directly, same
  "the record is the audit trail" approach as the console's top-level Audit
  Log). Reason codes are now admin-editable (`OtpReasonCodes`, seeded with
  the previous hardcoded lists) and managed from the new Administration
  page. The early/late bias detection threshold is now a persisted,
  admin-editable setting (`OtpSettings`) rather than a hardcoded constant -
  the new Threshold Tuner page previews a different value against the
  current month's already-fetched data before applying it. The Dashboard's
  "Power BI" placeholder is now a real, hand-rolled OTP % trend chart
  (`GET /otp-monthly-trend`) - percent only, no penalty-dollar figure, since
  no Attachment G penalty formula exists yet to build one from. Along the
  way, fixed a real bug where an approved exclusion never actually changed a
  route's Official OTP % once that route had a `route_label` (the candidate
  and route-row `route` fields used different conventions and silently
  never matched). New `migration-018-otp-exclusions-and-settings.sql`.
- **Detours & Closures module** - a new top-level console page collapsing the
  hand-tracked mix of Avail (when a detour is actually built there), staff
  email, and an Excel tracker into one place. Manual create/edit/delete with
  route-segment directions, and a computed status (Active/Upcoming/Monitor/
  Recently finished/Expired) shared by the API and UI so they can't drift.
  Read-only for `OCC.Viewer`, full access for `OCC.Publisher`/`OCC.Admin`.
  `Source`/`ExternalDetourId` ship now (both unused until the Avail Detours
  sync is built) so a future sync needs no migration-after-the-fact. Image
  attachments and the Avail sync itself are not part of this pass - see
  `detour-and-event-module-implementation-plan.md`.
- **Route Classification** (Admin page) - no Avail feed (OTP, Missed Trips,
  AVL Reports) distinguishes a fixed-route RouteID from a special-event one,
  so this is the one place MVTA OnBoard itself decides. A light, occasional
  admin step, not a bulk-import workflow.
- **Event bus positions (live)** in Event Monitoring - a third panel showing
  only vehicles classified `SpecialEvent` in Route Classification. Reuses
  the existing 5-minute AVL Reports poll rather than a second fetch against
  the same feed; correctly shows zero vehicles until a real classification
  row exists for an active event.
- Expanded the consolidated manual with application ownership, maintenance
  cadence, change control, database and integration care, incident recovery,
  and safe Claude/Codex collaboration guidance.
- Incorporated all 11 pre-implementation planning `.docx` files into the
  manual: resolved vendor decisions (ACS, FCM, SpareLabs, Avail/DoubleMap),
  the contractor B2B guest-access procedure, and the OTP Compliance /
  Special Event Vehicle Monitoring module designs (both fully specified, both
  still unbuilt). Added a document-inventory section (Manual §23) marking
  every planning document's current status so it's clear which to trust.
- **Known live-environment risk (unverified, not yet confirmed a bug):** the
  `dev` environment's Key Vault and SQL Server were originally built with
  public network access per `MVTA_OnBoard_Portal_Setup_Guide_1.docx`'s
  simplified no-code setup path, which that same document says must be
  hardened to private networking "before real rider data is flowing through
  it" - and `dev` is now effectively production. No one has confirmed in
  this repository whether that hardening was ever done. See Manual §11.
- Confirmation + STOP/HELP subscriber endpoints (blocked on Azure
  Communication Services provisioning).
- **Known live-environment issue:** the Function App's Easy Auth
  `allowedAudiences` setting is not yet applied on `func-mvta-restapi-dev`
  (Bicep has the fix; the live resource doesn't), so real Entra sign-ins
  currently get "Not authenticated" on authenticated reads/writes until an
  infra deploy or a direct `az webapp auth` fix is applied.
- **Compliance** tab, split out of OCC Tools: hosts OTP Compliance and
  Missed Trips under their own console tab, gated by a new dedicated
  `OCC.Compliance` app role (not yet created in the live Entra app
  registration - pending owner action; `OCC.Admin` retains access in the
  meantime) instead of the blanket `OCC.Admin` gate the rest of OCC Tools
  uses.
- **Decision Matrix QRG grid view**: a third view mode alongside List/Grid
  presenting the printed Quick Reference Guide's own section/subsection/
  Trouble-Probable Cause-Remedy-Reference table layout.
- This in-app **Changelog** page, listing released version history for all
  signed-in staff.
- Compose's affected-routes field now pulls a multi-select from the live
  `GtfsRoutes` registry (`GET /routes`) instead of free-typed text, falling
  back to the old comma-separated input if the registry can't be reached.
- **AI-drafted rider-friendly summaries in Compose:** a "Draft rider-friendly
  text" action calls the Claude API directly (new `ANTHROPIC_API_KEY` Key
  Vault secret - not yet provisioned, pending owner action) to turn a staff
  member's internal incident/delay report into a concise, plain-language
  rider alert for the existing `summary` field - always editable, never
  auto-posted. Fills the field's originally-documented purpose (`Messages.summary`'s
  schema comment already called it "Claude's short rider-facing summary,
  distinct from raw_text"); replaces the old Power-Automate-orchestrated
  design, which needed Power Platform setup that was never built.
- Compose's affected-routes multi-select now also includes **MVTA Connect**
  (the on-demand/paratransit service has no `GtfsRoutes` row of its own,
  since it's zone-based rather than a fixed route).
- The rider-facing summary in Compose now **auto-drafts** via Claude a
  moment after staff pause typing the internal report - only while the
  summary is still empty, so it never overwrites something staff already
  wrote or edited. The manual "Draft rider-friendly text" button still works
  for regenerating.
- **Live AVL vehicle positions** in Event Monitoring: a new `availAvlPoll.ts`
  timer ingests Avail's own proprietary AVL Reports API (distinct from the
  GTFS-Realtime feeds already ingested elsewhere - separate vehicle/route/
  block/run/trip keys, no guaranteed join to a GTFS `trip_id`), new
  `AvailAvlVehiclePositions` table, new `GET /avail-avl`, and a new table in
  the console showing every vehicle's latest reported position - added
  alongside the module's existing mock event-shuttle scenario, not replacing
  it. A real map overlay of these positions is a planned follow-up. New
  `AVAIL_AVL_REPORTS_API_KEY` Key Vault secret required (pending owner
  action) plus the `AVAIL_AVL_REPORTS_URL` app setting.
- **Fixed Route Departures**, a new Compliance-tab module tracking whether
  vehicles leave the garage on schedule using Avail's own dispatch-side
  Pullout Reports API (check-in/login/pullout timing, scheduled vs actual,
  plus Avail's own "Late Relief"/"Expired Pullout" classification) - a
  separate, more authoritative signal for garage-side lateness than anything
  inferred from GTFS or AVL data. New `fixedRouteDeparturesPoll.ts` timer
  (reuses the existing `AVAIL_AVL_REPORTS_API_KEY` - no new secret), new
  `FixedRouteDepartures` table that accumulates permanently (never
  overwritten) so late/expired pullouts can be trend-analyzed by operator,
  block, or date, and a new `GET /fixed-route-departures` endpoint with
  summary stats (late/expired counts, average delta). New `AVAIL_PULLOUT_URL`
  app setting required (imperative, pending owner action) plus the not-yet-run
  `migration-013-fixed-route-departures.sql`.
- **Real OTP % and fixed-route missed-trip data in OTP Compliance**, replacing
  that module's mock data with two new Avail360 feeds per
  `OTP-Feed-Evaluation-and-Recommendation.md`: the OTP Monthly By Route/Stop/
  Day of Week feed (real Attachment G departure-adherence numbers) and the
  Missed Trips By Route/Stop/Day feed (vendor-reported fixed-route missed-
  trip incidents, distinct from the existing GTFS-based real-time no-show/
  cancellation detection). Both poll **hourly** rather than only at month
  close-out, so the current month's numbers stay continuously up to date
  through the month rather than only appearing as a locked snapshot after it
  closes. Route Summary and Review Queue now read the live feed when it's
  configured and has data, falling back to the module's existing sample data
  otherwise; Monthly Assessments (previously a static placeholder) is now
  real, showing OTP % and missed-trip counts per route for the selected
  month. New `AVAIL_OTP_MONTHLY_URL`/`AVAIL_MISSED_TRIPS_URL` app settings
  required (imperative, pending owner action, reuse the existing Avail key)
  plus the not-yet-run `migration-014-otp-monthly.sql`/
  `migration-015-avail-missed-trips.sql`. **Known unconfirmed assumption:**
  neither feed's full response envelope was available to verify against -
  see the code comments in `otpMonthlyFeed.ts`/`availMissedTripsFeed.ts` and
  `HANDOFF.md` for what to check once a real response is available.

## [1.3.0] - 2026-07-28

### Added
- Missed-trip detection as a compliance investigation tool: explicit
  GTFS-RT cancellations and schedule-based silent no-shows (cross-
  referencing GTFS `calendar`/`calendar_dates`/`stop_times` against a daily
  log of trips actually observed in the realtime feed) are flagged into a
  new **Missed Trips** module for staff to investigate and validate
  (confirmed / false positive) - deliberately decoupled from the Suggested
  Alerts customer-notification queue, since a flagged trip is a compliance
  record, not an automatic rider alert. A "Prepare rider alert" action
  stays available as a separate, explicit step if an investigation
  determines customers should be notified.
- Suggested Alerts now auto-expire to `expired` after 2 hours unreviewed,
  across every detection source, via a new 15-minute timer.

## [1.2.2] - 2026-07-27

### Added
- **Alert via Teams** Compose option with separate Operations and Customer
  Service targets.
- Affected-route entry in Compose for internal and customer route-impact
  messages.
- Channel visibility in Active Messages and Audit Log.
- Future Teams Adaptive Card and approved-image connector contract in the
  consolidated manual.
- Dispatch channel-selection unit tests.

### Fixed
- Subscriber dispatch now honors explicit SMS and email selections, preventing
  internal or Teams-only messages from being sent to riders.
- The rider application now explicitly requests Website messages, preventing
  internal-only messages from appearing as public service alerts.

## [1.2.1] - 2026-07-26

### Added
- Persistent OCC alert preparation through the existing Suggested Alerts
  human-review queue, with source-qualified deduplication.
- Direct navigation to and highlighting of the prepared review item.
- Non-persistent customer-language previews for local sample scenarios.
- A consolidated operations, product, architecture, deployment, and roadmap
  manual.

### Changed
- Preview banners now explain that mock sign-in cannot access operational data
  and that preview actions are not saved.
- Suggested Alerts can display and focus a previously reviewed item without
  offering invalid approval actions.

## [1.2.0] - 2026-07-26

### Added
- **Fixed Route Service Risk** OCC workspace with exception-first monitoring,
  future departure predictions, first threshold-crossing departure,
  confidence evidence, a stop-by-stop timeline, and access to the existing
  current-telemetry view.
- **On-Demand Service Quality** OCC workspace for the 25-minute wait-time
  standard, including predicted versus actual wait, assignment context,
  confidence evidence, and customer-update workflow actions.
- Vendor-neutral `GET /api/on-demand-risks` contract and
  `MonitoredOnDemandWaits` schema for a future on-demand feed adapter.
- Current-state, suggested-improvements, and feature-implementation handoff
  documents.

### Changed
- GTFS TripUpdate processing now treats departures as MVTA's operational
  measure, retaining predictions for every usable future stop.
- Fixed-route escalation now uses the maximum predicted future departure
  delay across two consecutive polls instead of only the first stop's current
  delay.
- GTFS delay-suggestion deduplication now includes service date so recurring
  scheduled trips can create new exceptions on later service days.

## [1.1.0] - 2026-07-24

### Added
- GTFS-Realtime Alert feed ingestion (Phase 1): bridges MVTA's
  dispatcher-entered CAD detour/service-change notices into the Suggested
  Alerts human-review queue, deduped by feed entity ID.
- GTFS-Realtime TripUpdate delay detection (Phase 2): a 5-minute poll logs
  every monitored trip's live delay (all delays reported, regardless of
  size) and escalates a delay sustained over 15 minutes across 2
  consecutive polls into a Suggested Alerts candidate, with real stop
  names resolved from a daily static-GTFS sync. New **Live Delays** module
  in OCC Tools shows every monitored trip's current status.
- Automatic retry-with-backoff on GET requests in the shared API client,
  to absorb transient Front Door edge-node propagation flakiness.
- Redesigned staff console sign-in screen (centered card, brand gradient
  backdrop) to match MVTA's other internal tools.
- This changelog, and a build-time app version badge wired to
  `package.json` instead of a hand-maintained string.

### Fixed
- Onboard-console blank page when served through Azure Front Door at
  `/console/*` - Front Door forwards requests without stripping the
  `/console` prefix, and the server-side rewrite rule meant to do that
  never reliably applied; the build now nests its own output under a
  literal `console/` folder so the deployed paths match the requested
  URLs directly, with no rewrite dependency.
- Rider-app "Failed to fetch" on Service Alerts, caused by a misconfigured
  `VITE_API_BASE` GitHub Actions variable pointing at the Function App's
  raw hostname (blocked by the app's own CSP) instead of a same-origin
  relative path.
- `created_by` on message creation is now derived from the verified auth
  principal server-side rather than trusted from the request body, except
  for the `System.Ingestion` service-principal fallback.

## [1.0.0] - Initial release

- React + Vite + TypeScript monorepo replacing the original single-file
  HTML mockups: **rider-app** (public Service Alerts + opt-in) and
  **onboard-console** (Entra-gated staff dashboard).
- Full REST API on Azure Functions (TypeScript): messages CRUD/retract,
  subscribers, admin config, Suggested Alerts human-review queue.
- Role-based access control via Entra ID app roles (OCC.Viewer/
  Publisher/Admin, System.Ingestion), enforced both client-side (UI
  gating) and server-side (`requireRole`).
- OCC Tools: Event Monitoring, Decision Matrix, and OTP Compliance
  modules, consolidated into one cohesive design system.
- Security hardening: CSP/security headers, Front Door + WAF, managed-
  identity DB/Storage/Service Bus auth (no standing secrets), GitHub
  Actions CI/CD via OIDC federated identity.
