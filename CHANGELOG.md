# Changelog

All notable changes to MVTA OnBoard are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions track
`frontend/packages/onboard-console/package.json` (the staff console's `v`
badge and footer read this version at build time - see `vite.config.ts`).

## [Unreleased]

- **Fixed AVL Reports returning zero vehicles on every poll since launch.**
  Root cause confirmed live: `fetchAvlReports` built its `{Start
  DateTime}/{End DateTime}` URL segments with `encodeURIComponent`, which
  escapes colons to `%3A` - Avail's API silently no-ops on that (returns a
  clean `success: true` with an always-empty `"AVL Reports"` array,
  no error) instead of rejecting it. 14 days of App Insights traces showed
  every 5-minute poll completing without a single thrown error, which is
  what made this invisible - the request looked entirely healthy. Ty
  confirmed by running the same request via curl with colons left literal
  and got real vehicle data back immediately. Fixed by escaping only the
  space (`%20`), leaving colons literal, matching the confirmed-working
  request exactly. Also added: raw HTTP status/URL/body logging on every
  call (success or failure) for future diagnosis, and tolerance for
  `AVAIL_AVL_REPORTS_URL` having a trailing `/MVTA` segment already baked
  in (matching the other five Avail feed settings' convention) -
  `normalizeBaseUrl()` strips it first so Property is never appended
  twice into `.../MVTA/MVTA/...`.
- **Route Classification had no way to remove a classification.** Confirmed
  live - Ty classified a real fixed route as SpecialEvent for testing and
  had no way to undo it. New `DELETE /route-classification/{routeId}` +
  a "Remove" button next to each row. Hard delete, not this repo's usual
  soft-delete/deactivate convention (Detours, OtpReasonCodes) - this table
  is a pure current-state lookup with no audit-trail history riding on old
  rows, unlike those two, so there's nothing a hard delete would corrupt.
  Also replaced the plain `<select>` route picker with a searchable
  chip-list (matching Compose's existing affected-routes picker) per Ty's
  preference, and fixed a crash (`Cannot read properties of undefined
  (reading 'length')`) from assuming a newly-added backend response field
  was always present - a real risk during any deploy where frontend and
  backend land at slightly different times.
- **Fixed the Historical data backfill panel 504ing on any real range**:
  confirmed live - a 5-month request (Jan-May 2026) hit a gateway timeout,
  since `otp-historical-backfill` was doing every month's OTP Monthly
  fetch plus one Missed Trips fetch across the whole range synchronously
  in a single HTTP request. `POST /otp-historical-backfill` now takes one
  month per request (`{month: "YYYYMM"}`, not `{from, to}`); the
  Administration panel loops one request per month client-side instead,
  showing real per-month progress and staying within any request timeout
  regardless of how wide a range is entered.
- **Event Monitoring's real map overlay** (`event-module-implementation-
  plan.md`, Part A3 - Parts A1/A2, Route Classification and the event-bus
  filtering itself, already shipped). The mock event-shuttle scenario
  (POOL vehicles, the static Lot A/Fairgrounds schematic, swap-in picker,
  Claude-drafted delay-alert cards) is **retired**, not kept alongside real
  data - it modeled a Phase 2+ alerts/publish workflow explicitly out of
  scope for this pass (see the plan's redrafted user story, Part A0).
  "Event bus positions (live)" now renders an actual Azure Maps basemap
  (new `azure-maps-control` dependency) showing only `RouteClassification`
  `SpecialEvent` vehicles, with a companion list alongside it; "Live AVL
  vehicle positions" (every vehicle, unfiltered) stays a table, unchanged.
  Zero-standing-secret: no Maps subscription key is ever shipped to the
  browser - a new `GET /maps/token` endpoint uses the REST API Function
  App's own managed identity (granted Azure Maps Data Reader) to mint a
  short-lived Azure AD token server-side for the SDK's `anonymous` auth
  mode, same identity-based pattern as Blob Storage SAS minting and
  Service Bus.
  **LIVE as of 2026-08-06**: the owner provisioned the Azure Maps account
  directly (`rg-mvta-onboard-dev/mvta-onboard-maps`, Gen2, `westus2` - not
  via `maps.bicep`, same "built outside Bicep first" pattern as Front Door;
  `main-phase1.bicep`'s `mapsAccountName`/`location` updated to match so a
  future deploy manages this resource in place instead of creating a
  second, unused one). `func-mvta-restapi-dev`'s managed identity was
  granted Azure Maps Data Reader on the account, and `AZURE_MAPS_CLIENT_ID`
  is set to its `uniqueId`. **Follow-up, not blocking**: the manually-
  created account still has `disableLocalAuth: false` (subscription-key
  auth technically still possible, though this code never uses it) -
  `maps.bicep` sets `disableLocalAuth: true`; running it against the
  existing resource would tighten this to match every other resource's
  identity-only posture in this project.
- **Fixed the event-bus map hanging forever on "Loading map…"**: confirmed
  live once the account was actually wired up - the console's own
  Content-Security-Policy never allowed the Azure Maps domain at all.
  `img-src`/`connect-src` were `'self'`-only (no `atlas.microsoft.com`),
  and there was no `worker-src` directive, but `azure-maps-control` loads
  map tiles from `atlas.microsoft.com` and spins up Web Workers via
  `blob:` URLs for tile processing - the browser was silently blocking
  every one of those requests, so the map's `'ready'` event never fired
  and the loading overlay never cleared. `staticwebapp.config.json` now
  allows `https://atlas.microsoft.com` in `img-src`/`connect-src` and adds
  `worker-src 'self' blob:`.
- **Route Classification had no way to discover what actually needs
  classifying.** AVL Reports carries only a bare numeric RouteID, never a
  name (confirmed - see `availAvl.ts`'s `AvailAvlReport`), so the Admin
  page's route picker (`GtfsRoutes`, fixed-route-only) never surfaced
  Avail's own special-event/non-revenue naming convention
  (`Special1111`, `Rescue Bus`, `Pivot`, etc.) at all - there was
  genuinely nothing to select. `GET /route-classification` now also
  returns `unclassified`: every RouteID `AvailAvlVehiclePositions` has
  actually seen with no classification row yet, with a best-effort label
  pulled from OTP Monthly/Missed Trips when that route happens to have
  generated schedule-adherence data (null, not a guess, otherwise). Admin
  page shows this as a new "Seen in live AVL data, not yet classified"
  list above the classification table, each row with a one-click
  "Classify as Special Event" action that pre-fills the form instead of
  requiring the admin to already know the RouteID.

## [1.5.0] - 2026-08-06

- **OTP historical backfill** - a new admin-only action (`POST
  /otp-historical-backfill`, plus a "Historical data backfill" panel in
  OTP Compliance's Administration page) fills OTP Monthly + Missed Trips
  months *outside* the daily poller's 3-month trailing window - e.g.
  January-May 2026, before this feed's poller existed. "And beyond" (future
  months) needs nothing new - the trailing window already rolls forward on
  its own; this only backfills the historical gap behind it. Idempotent
  either direction (OTP Monthly upserts by key; Missed Trips deletes+
  reloads whole months), capped at 24 months per request. The per-month
  MERGE and the delete+reload were extracted out of the two daily pollers
  into shared functions (`upsertOtpMonthlyReport`, `replaceMissedTripsForMonths`)
  so the backfill endpoint and the daily pollers share one implementation
  instead of two copies.
- **Missed Trips UX pass** (route/date filters, "why was this flagged",
  friendlier trip labels, no more stray rider-notification action, a
  Monthly Assessments view, and a reason-code dropdown):
  - **Route + date filters** on the Flagged Trips list - previously no way
    to narrow it down to one route or one service date.
  - **"Is there any way to determine why the flag exists?" - not until
    now.** Neither of `gtfsMissedTripsPoll.ts`'s two detection paths
    (explicit GTFS-RT cancellation vs. a scheduled trip that never
    reported at all) ever recorded which one fired - the frontend
    hardcoded `detectionType: "unknown"` because the field genuinely
    didn't exist. `migration-023` adds `MonitoredMissedTrips.detection_type`;
    the detail pane now shows "Explicit cancellation (GTFS-RT)" or
    "Scheduled no-show (never observed)" - rows flagged before the
    migration read back "Unknown - flagged before detection tracking was
    added," shown honestly rather than guessed.
  - **Friendlier trip labels** - the flagged-trip list used to lead with
    the raw GTFS `trip_id` (e.g. "Trip t1F4-b5-sI1C-v62"), which is
    meaningless to a reviewer. It now leads with the route's real name
    (via the existing `GET /routes` registry) and "Scheduled {time}"; the
    raw ID moves to a de-emphasized "Ref" line in the detail pane for
    dispatch/support lookups.
  - **Removed the "Rider notification (optional)" section** (the
    "Prepare rider alert" button and its preview-draft UI) - Missed Trips
    has been an investigation-only tool since the original compliance
    rework ("this is not a customer notification queue"), and this leftover
    action contradicted that framing.
  - **Reason-code dropdown alongside investigation notes** -
    `MonitoredMissedTrips.reason_code` (also `migration-023`) plus a new
    `applies_to='missed_trip'` value on the existing `OtpReasonCodes` table
    (seeded with Vehicle breakdown / Operator no-show / Dispatch error /
    Weather / Detection error / Other) - reused rather than building a
    third parallel reason-code table. Admin-editable from OTP Compliance's
    Administration page alongside the other two reason-code tables.
  - **New Monthly Assessments view** (`GET /missed-trips-monthly-summary`)
    - a per-month, per-route breakdown of cancellations vs. no-shows and
      confirmed vs. false-positive vs. unreviewed counts, mirroring OTP
      Compliance's own Monthly Assessments for the same "how are we
      trending" question.
- **Review Queue: "Copy last month's decisions"** (Option A of
  `plans/otp-exclusion-carryover-enhancement-scope.md`) - a stop/route/
  day-of-week candidate that matches an approved/rejected decision from
  the prior service month now shows "Last month: Approved/Rejected —
  &lt;reason&gt;" plus a one-click "Copy last month" button; a bulk banner
  offers "Copy all N matching last month's decisions" when more than one
  pending candidate matches. Still writes a fresh, real, dated
  `OtpStopExclusions` row via the normal PUT for the *current* month - not
  a silent carry-forward - so compliance semantics (one attributed record
  per stop per month) are unchanged; it only removes the repeat clicking
  for stops whose exclusion reason is genuinely a standing fact, not a
  fresh judgment call.
- **Fixed the "Internal server error" on Review Queue approve/reject**:
  `OtpStopExclusions.day_of_week` had the exact same too-narrow-column bug
  just fixed for `OtpMonthlyRouteStopDay` (`NVARCHAR(3)` → `NVARCHAR(20)`,
  `migration-022`) - approving/rejecting a candidate with a long
  day-of-week value hit the same SQL error, surfaced as a raw error banner
  that then persisted across month switches (nothing cleared it). Also
  fixed: `actionError` now clears when the service-month picker changes,
  and the month-independent fetch (settings/date exclusions/reason codes)
  no longer shares one `Promise.all` - one flaky call used to discard all
  four results, including reason codes that had actually loaded fine,
  which looked like "reason codes are missing" but had nothing to do with
  reason codes themselves.
- **Administration's reason-code management is now real CRUD**: inline
  rename (click a label or "Rename"), up/down reordering (drives dropdown
  order in Review Queue/Weather), and a dedicated "+ Add" per table
  instead of one shared add-form with an easy-to-miss "applies to"
  dropdown. No hard delete - deactivating remains the standing convention
  for retiring a code older records may still reference.
- **Fixed the real bug behind "OTP Monthly/Missed Trips have no data":
  both had the wrong envelope key, not empty data.** Caught the moment
  tonight's first trailing-window backfill actually ran and the dormant
  diagnostic finally fired. `otpMonthlyFeed.ts` guessed `OtpByRouteStopDayAgg`
  (real key: lowercase `otp`); `availMissedTripsFeed.ts` guessed
  `MissedTripsByRouteStopDay` (real key: lowercase `missed`) - both with a
  sibling `results` metadata key, same pattern as Detours
  (`Detours` → `detours`). Every month either feed has ever polled was
  never actually empty. Fixed, tests updated. **Confirmed live** by
  manually re-triggering after deploy: `otpMonthlyFeedPoll` logged
  `414 reports seen, 260 rows upserted for 202608` - real OTP data, in
  the database, for the first time.
- **Fixed a second real bug found while confirming the above**:
  `OtpMonthlyRouteStopDay.day_of_week` was `NVARCHAR(3)` (sized for
  "Mon"/"Tue" per the one sample record ever available), too narrow for
  some of Avail's real values - caused 154 of the 414 real rows above to
  fail with a SQL data-length error instead of saving. New
  `migration-021-otp-monthly-day-of-week-width.sql` widens it to
  `NVARCHAR(20)`. **Re-verified after the migration ran: 100% success,
  all three months** - `414/414` rows for August, `908/908` for July,
  `910/910` for June. **2,232 real OTP records now in the database, zero
  failures.** OTP Monthly is fully live.
- **OTP Compliance cleanup**: removed the dead "Service Week / Metric /
  Imported" stat strip that appeared on every OTP page - a leftover from
  the module's original CSV-import design, hardcoded to a fixed date
  ("Jul 7 – Jul 13, 2026") and a made-up import count with no live meaning
  at all. Monthly Assessments no longer shows Avail Missed Trips incident
  counts alongside OTP % - decluttered to OTP-only per Ty's direction
  (note: this isn't the same data as the separate "Missed Trips"
  Compliance tab, which is GTFS-RT-based real-time detection, not Avail's
  feed - removing this leaves `GET /avail-missed-trips` with no UI
  consumer for now, though the feed keeps collecting data). Every
  service-month display (Monthly Assessments, the live-data banner, Audit
  Stream's "current month" label, the Dashboard trend chart's month
  labels) now formats as `MM/YYYY` instead of raw `YYYYMM`.
- **Fixed a real live bug: Avail Detours sync's envelope key was wrong.**
  Guessed as `Detours` (capital D); the real key is lowercase `detours`.
  Caught by the diagnostic added earlier this session, confirmed against
  live traffic today. Also added the same diagnostic to
  `availMissedTripsFeed.ts` (throws naming the real key instead of
  silently returning zero rows if this guess is ever wrong too - the same
  fix already applied to `otpMonthlyFeed.ts`/`availDetoursFeed.ts`).
  **Separately confirmed and fixed:** `availAvlPoll.ts` (Live AVL vehicle
  positions) had been failing 100% of its runs with HTTP 404 since
  deployment (~1800 consecutive failures) - `availAvl.ts` was sending a
  single date-only URL segment instead of the feed's actual documented
  `/{Property}/{StartDateTime}/{EndDateTime}` shape. Fixed to send all
  three: an explicit `MVTA` Property segment (`AVAIL_AVL_REPORTS_URL` no
  longer bakes Property into the base URL, unlike every other Avail feed
  setting in this app - it must now end at `.../AVLReports/v1`, **update
  the live app setting to match before this deploys**) plus two full,
  URL-encoded datetime segments; now polls a rolling 10-minute window each
  run. **`fixedRouteDeparturesPoll.ts`/Pullout Reports deliberately left
  broken for now** - same 404 pattern, but its real API spec was never
  confirmed, so a fix here would be a second guess stacked on the first;
  needs the actual spec, not another guess.
- **Trailing-window daily backfill for OTP Monthly + Missed Trips**: both
  polls changed from hourly/refresh-current-month-only to daily,
  re-fetching current month + prior 2 every run - a poller that only ever
  asks about "whatever month is current right now" has no way to notice a
  month that was empty on day 1 but populated by Avail days later
  (confirmed live: both August and a fully-closed July came back
  genuinely empty). Also drops the hourly cadence for OTP Monthly, since
  it was polling a month-level aggregate that structurally cannot change
  hour-to-hour.
- **New: sub-monthly OTP trending feed** (`OtpByRouteStopDayHour`,
  promoted from secondary/drill-down per the same investigation) - new
  `OtpDailyRouteStopHour` table (90-day rolling window, not permanent
  history), new daily timer, new `GET /otp-daily`. **Least-confirmed
  integration in this project** - zero sample response exists anywhere for
  this specific feed, unlike every other one built here; the field mapping
  is a best-guess by analogy to sibling feeds, flagged prominently in code.
  No UI reads this yet. **Needs `migration-020-otp-daily.sql` run and
  `AVAIL_OTP_DAILY_URL` set on `func-mvta-restapi-dev` before it goes
  live.** See `otp-compliance-live-data-rethink.md` for the full writeup
  and everything still open (Pullout's real spec, whether Avail has any
  OTP data for MVTA at all, the UI rethink proposal).
- **OTP Compliance service-month selector**: the module always defaulted
  to the current month for its live Avail OTP Monthly/Missed Trips data,
  with no way to view an earlier month - a brand-new month with no Avail
  aggregate yet looked identical to "feed not configured." A new month
  picker in the module's header now drives Route Summary, Review Queue,
  Monthly Assessments, and Audit Stream's "current month" scope from one
  selection, so staff can check whether a past month (which should have
  real accumulated data) loads correctly instead of only ever seeing
  whatever the current month happens to have.
- **Route Classification (Admin)**: the Route ID field is now a selector
  populated from the live route registry (`GET /routes`, the same one
  backing Compose's affected-routes picker) instead of a free-text number
  field - picking a known route beats typing a raw numeric ID blind.
  Falls back to the original number input if the registry can't be
  reached or is empty, same graceful-degradation convention as Compose.
- **Avail Detours sync (Part B4-B5)**: a new 15-minute timer
  (`availDetoursSync.ts`) polls Avail's own Detours feed and keeps
  `source='avail'` records in sync automatically - one real duplicate-entry
  elimination for whatever subset of closures is actually built as a formal
  Avail detour. Avail returns multiple rows per detour (one per direction);
  `availDetoursFeed.ts` groups them by `DetourID` into one `Detours` row +
  N `DetourSegments`. Upserts by `external_detour_id`; never touches a
  `source='manual'` row (operator-message/stop-closure entries that never
  appear in Avail's feed at all). If a synced row has since been hand-
  edited in OnBoard (`last_edited_manually`), the sync now skips
  overwriting it indefinitely but still stamps a new
  `avail_last_seen_at` (migration-019) so staff can tell the sync hasn't
  silently lost track of it - both surfaced in the detail panel. Reuses
  the existing `AVAIL_AVL_REPORTS_API_KEY` - the owner has confirmed
  production does not need a separate subscription key for Detours.
  Migration-019 has been run against the dev DB. **Still needs
  `AVAIL_DETOURS_URL` set on `func-mvta-restapi-dev` and this code
  committed/deployed** before it goes live; same unconfirmed-envelope-key
  caveat as every other Avail feed in this project (guessed as
  `result.Detours`, unverified against a real response).
- **Detour image attachments**: staff can attach photos (signage, hand-
  marked maps, screenshots) to a detour record - a multi-file upload
  control in the entry form, resized client-side before upload, with a
  thumbnail row and click-through to full size in the detail panel. Images
  upload directly to a new Blob Storage account via short-lived SAS tokens
  minted by the Function App's own managed identity - never a storage
  account key, and images never pass through the API's own request body.
  A new daily timer purges images once their detour has been over for 30+
  days (privacy default - a phone photo of a road closure can incidentally
  include plates or bystanders). New `infra-phase1/modules/storage-detour-
  images.bicep` (private container, no public-read) - **a new Azure
  resource with real cost, not deployed until explicitly approved.**
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
