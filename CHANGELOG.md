# Changelog

All notable changes to MVTA OnBoard are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions track
`frontend/packages/onboard-console/package.json` (the staff console's `v`
badge and footer read this version at build time - see `vite.config.ts`).

## [1.5.57] - 2026-08-22

- **Manage Monitoring Areas directly.** Event Administration now offers a Rename action alongside the existing purpose, boundary-editing, and audited deactivation controls. Deactivation keeps the record for audit rather than hard-deleting operational history.
- **Make Event Administration easier to scan.** Event AVL settings, route classification, Monitoring Area authoring, reference locations, and direction rules now use compact collapsible sections with clearer titles, descriptions, and live counts.
- **Make direction rules readable and message templates extensible.** Rules can now carry an optional operator-facing name; standard Event AVL message templates accept an appended instruction, and both editing and the saved-rule table use that plain-language framing.
- **Manage Area purposes as data.** Administrators can add, rename, and delete unused custom purposes from Event Administration. The built-in Staging, Corridor, Venue, and Other purposes are protected, and custom purposes safely fall back to the generic live-area status.
- **Use friendly location categories.** Reference locations now display “Park & ride” and other operator-facing labels instead of stored codes such as `park_and_ride`.
- **Find and inspect map resources faster.** The authoring map now filters Monitoring Areas and locations by name or category, and selecting a row focuses and highlights that resource on the map.

## [1.5.55] - 2026-08-22

- **Resolve two parallel Event AVL designs in favour of the notification badge.** `main` released 1.5.47 with the open notification queue leading above the vehicle map; this branch had since reframed it as a count badge in the context bar that opens a queue drawer, so that notifications stop competing with the map for the first viewport without becoming less visible. The badge wins as the later, documented decision, and the queue-first arrangement described in 1.5.47 no longer applies.
- **Queue-first semantics are kept in full.** Pending, acknowledged, and failed notifications all remain in the open queue - a failed delivery stays retryable rather than terminal - which both designs had implemented identically.
- **Remove the superseded queue-first styles.** The `evmon-primary-queue` and variant-B grid rules had no consumer left after the reframing, so they are deleted rather than merged forward as dead selectors.

## [1.5.54] - 2026-08-22

- **Polish the in-app release notes.** The Changelog now has a clearer hierarchy, a prominent current-build indicator, and refined expandable release cards that are easier to scan across desktop and mobile.

## [1.5.53] - 2026-08-18

- **Geofences with the same name can be told apart and removed.** Two "Eagan Bus Garage" boundaries exist in real data, and the Event Administration table rendered only the name, so identical rows could not be distinguished and neither could be removed with any confidence about which was going. Rows that share a name now show the identifier that separates them, alongside the Event Plans using each one and when it was last updated.
- **The geofence and location tables moved above the map.** Removing or auditing a boundary previously sat below a 420px canvas and its drawing toolbar, which is why the control went unfound.
- **Deactivating a geofence says what it affects.** The confirmation now names the Event Plans holding it in scope, and states that governed plans keep running from their published scope snapshot until a reviewed revision removes it.
- **Duplicate linked resources are distinguishable in Event Planning too.** Removing the wrong one needs another revision to undo, so colliding labels now carry their identifier in the visible text and the accessible name.

## [1.5.52] - 2026-08-18

- **The scope map now shows that it is a control, not a picture.** Hovering a boundary or point changes the cursor and opens a popup naming the resource and what selecting it will do - add it, remove it, or that the Event Plan is read-only at its current status. Previously nothing distinguished a clickable boundary from a drawn one.
- **The scope map opens on the scope.** It used a fixed centre and zoom, so geometry outside that view rendered as an apparently empty map; it now fits once to the boundaries and points it has, and gained a zoom control.
- **An Event Plan with no authored geometry explains itself.** A console with no geofences or transit locations rendered a blank basemap that reads as broken. It now states that boundaries are drawn in Event Administration and links there.
- **The list is named as the equivalent path.** The map is pointer-driven, so its help text now states that the list view does the same thing without one.

## [1.5.51] - 2026-08-18

- **The Event Plan scope map reports a failed map instead of hanging.** Fetching the Azure Maps token can succeed while the map itself still fails to authenticate or initialise, and the panel sat on "Loading the scope map…" indefinitely - which reads as a hang rather than a failure. Confirmed against a running console; it now surfaces the failure as an alert.

## [1.5.50] - 2026-08-18

- **Choose an Event Plan's geographic scope on a map.** Geofences and transit locations can now be added and removed by selecting them on a map beside the list, with in-scope boundaries filled and available ones dashed. Routes stay list-only - special service is absent from the GTFS schedule, so routes have no geometry to draw - and the list remains a complete alternative for every resource type.
- **Copy an Event Plan to its next run.** Recurring Events reuse their routes, geofences, and locations almost unchanged while the dates always differ, so `Copy to a new Event Plan` carries the scope and deliberately leaves the operating period unset - landing the new draft on the dates as its first outstanding readiness item.
- **The workspace stages stopped pretending to be destinations.** Plan, Review, and Activate all pointed at the same `/events/planning`, so choosing one reloaded the page you were already on. They now render as status; only Configure, which genuinely navigates to Event Administration, remains a link.

- **The Event Planning next action now performs the step instead of scrolling to it.** Its button previously called `scrollIntoView` in every state, so the most prominent control on the page moved the viewport rather than advancing the work. It now submits for review, approves, and activates directly; an incomplete draft jumps to the resource selector that resolves the first missing readiness item, with that resource tab already chosen.
- **Advancing an Event Plan no longer requires scrolling to a duplicate button.** The lifecycle panel repeated the same primary transition at the bottom of the page; the Next action panel is now the single control, and the panel points to it. Completion stays with the other deliberate active-plan controls, where suspend and modify already live.
- **The conflict override reason moved into the panel that activates.** The one field standing between an operator and a live scope is no longer somewhere further down the page.
- **Event AVL histories are readable.** Message history, geofence crossings, and audit entries rendered as single muted paragraphs with every field run together by dots; each entry now carries its timestamp, label, and detail as distinct elements, with real empty states and a scroll region per panel.
- **Event Planning links to Event AVL directly.** The activation handoff pointed at the legacy `/event-monitoring` redirect rather than `/events/avl`.

## [1.5.47] - 2026-08-17

- **Show the activation checklist while the Event Plan is still a draft.** The itemized readiness list and its repair links previously appeared only once the plan reached `approved` - after every item was already satisfied. Draft is the longest phase and the one where items are actually outstanding, so the list now renders from draft onward beside the activation readiness gate.
- **Send the "complete the checklist" next action to the right panel.** The action that asks for a missing operational resource scrolled to *Plan details* (the Event picker and dates) instead of *Scope resources*, which is where routes, geofences, and locations are actually linked.
- **Restore the staff console typecheck.** `@mvta/shared`'s build output had drifted behind its source, so the console typechecked against declarations missing `route_conflict`, `EventServicePlanRevision.links`, and the conflict-override argument. Rebuilding the shared package clears all 13 errors in Event Planning and the remaining Detour errors across the package. The affected behavior worked correctly at runtime; only the build was broken.

## [1.5.48] - 2026-08-17

- **Keep Event Planning context across resource administration.** Missing geofence links now preserve the selected Event Plan and revision, and Event Administration always offers an explicit return to Planning.
- **Clarify Event Plan terminology and review evidence.** User-facing labels now consistently call the workflow object an Event Plan, lifecycle completion is labeled Completed, and review evidence lists the selected resource names.
- **Improve Event Planning recovery and accessibility.** Empty consoles offer a first-Event action, resource selectors retain independent searches and failed bulk links, selected panels announce their changes, and remove actions identify their resource.

## [1.5.50] - 2026-08-18

- **Choose an Event Plan's geographic scope on a map.** Geofences and transit locations can now be added and removed by selecting them on a map beside the list, with in-scope boundaries filled and available ones dashed. Routes stay list-only - special service is absent from the GTFS schedule, so routes have no geometry to draw - and the list remains a complete alternative for every resource type.
- **Copy an Event Plan to its next run.** Recurring Events reuse their routes, geofences, and locations almost unchanged while the dates always differ, so `Copy to a new Event Plan` carries the scope and deliberately leaves the operating period unset - landing the new draft on the dates as its first outstanding readiness item.
- **The workspace stages stopped pretending to be destinations.** Plan, Review, and Activate all pointed at the same `/events/planning`, so choosing one reloaded the page you were already on. They now render as status; only Configure, which genuinely navigates to Event Administration, remains a link.

- **The Event Planning next action now performs the step instead of scrolling to it.** Its button previously called `scrollIntoView` in every state, so the most prominent control on the page moved the viewport rather than advancing the work. It now submits for review, approves, and activates directly; an incomplete draft jumps to the resource selector that resolves the first missing readiness item, with that resource tab already chosen.
- **Advancing an Event Plan no longer requires scrolling to a duplicate button.** The lifecycle panel repeated the same primary transition at the bottom of the page; the Next action panel is now the single control, and the panel points to it. Completion stays with the other deliberate active-plan controls, where suspend and modify already live.
- **The conflict override reason moved into the panel that activates.** The one field standing between an operator and a live scope is no longer somewhere further down the page.
- **Event AVL histories are readable.** Message history, geofence crossings, and audit entries rendered as single muted paragraphs with every field run together by dots; each entry now carries its timestamp, label, and detail as distinct elements, with real empty states and a scroll region per panel.
- **Event Planning links to Event AVL directly.** The activation handoff pointed at the legacy `/event-monitoring` redirect rather than `/events/avl`.

## [1.5.49] - 2026-08-18

- **Align fixed-route service-risk counts.** Overview, diagnostics, the exception list, and summary tiles now use the same raw-seconds threshold predicate, preserving missing-prediction telemetry instead of rounding before filtering.
## [1.5.49] - 2026-08-22

- **Restore the missing in-app release notes.** The console's Changelog page and "What's new" popover were missing 1.5.46 and 1.5.47 entirely - `changelogData.ts` had not been hand-synced when those releases were cut, so the popover reported "not available yet" for the deployed build. Both versions are now present.

## [1.5.48] - 2026-08-22

- **Collapse and expand the side navigation.** The primary navigation rail now has a collapse control in its brand row that shrinks it to a 64px icon-only rail, giving map- and table-heavy pages (Event AVL, Detour Reports) the extra width. Every destination stays reachable while collapsed - group headings hide but their links remain, and each icon carries its label as a tooltip. The choice persists across reloads, and below 860px the existing off-canvas drawer still governs, so the collapsed rail is desktop-only.

## [1.5.47] - 2026-08-20

- **Lead Event AVL with the open notification queue.** Open Event notifications now appear above the vehicle map as the page's primary action, rather than below it; the map is retitled "Vehicle map" to match. Open-queue membership (pending, acknowledged, failed) is now a single named predicate covered by a test.

## [1.5.46] - 2026-08-16

- **Organize administration into a management workspace.** Administration now has modular navigation for access, Event resources, service configuration, integrations, governance, and subscribers. Event Planning and Event AVL are grouped under a dedicated Events workspace, with legacy links preserved.
- **Remove the duplicate Administration landing page.** `/admin` now opens the operational Service Configuration module directly while the remaining administration modules stay available in the secondary navigation.
- **Remove the duplicate Administration sidebar label.** The operational Administration navigation now appears under one label instead of repeating the section heading and expandable item.

## [1.5.43] - 2026-08-16

- **Recover from invalid geofence rings.** Event Planning now rejects self-intersecting polygons before save, restores the previous boundary when an edit is invalid, and keeps the map available for another attempt.

## [1.5.38] - 2026-08-15

- **Populate the unassigned vehicle queue.** Event AVL now projects every fresh AVL vehicle; active plan and geofence scope continue to control assignments and crossing detection.

## [1.5.39] - 2026-08-15

- **Clarify Event Planning.** Operating periods now use separate local date/time fields, resources use searchable checkbox selection, and activation presents a simpler readiness handoff.
- **Improve direction-rule authoring.** Direction rules are organized into matching, movement, and message steps with compass presets, clearer delivery labels, and an Event AVL message preview.

## [1.5.40] - 2026-08-15

- **Identify buses by route in event messages.** Crossings now retain the AVL route ID alongside the bus number, so multiple buses operating the same event route remain distinguishable in Event AVL and Teams notifications.
- **Allow geofence removal.** Administrators can remove a geofence from the resource list; removal deactivates it and preserves the record for audit. Active-plan geofences remain protected.

## [1.5.41] - 2026-08-15

- **Separate the Event AVL queue from history.** Every crossing in an active operating scope now creates an operational queue item, with matched rules controlling the message and manual or automatic delivery. Completed Teams deliveries remain available in investigative history.

## [1.5.42] - 2026-08-15

- **Add operational Event AVL messaging control.** Planning now defines standard geofence message types for departing, passed, arriving-soon, or custom messages. Event AVL controls automatic Teams delivery for the selected active operating period; the arriving-soon message is triggered by entering its configured approach geofence.

## [1.5.37] - 2026-08-15

- **Make expired Event AVL sessions recoverable.** The monitoring page now identifies an expired sign-in and provides a direct Sign in again action instead of remaining in a misleading loading state.

## [1.5.36] - 2026-08-15

- **Recover from expired AVL sessions.** Authenticated GET requests now refresh the Entra access token once after a 401 response before showing a feed error.

## [1.5.35] - 2026-08-15

- **Show live AVL vehicles before Event selection.** Event AVL now loads the shared active-vehicle feed immediately; selecting an Event continues to add plan membership and geofence scope.

## [1.5.34] - 2026-08-15

- **Improve Route Classification readability.** The table now uses operator-friendly route names, service-type explanations, explicit label guidance, readable update details, route counts, and descriptive actions.

## [1.5.33] - 2026-08-14

- **Make Event messages operationally identifiable.** Geofence notifications
  now include the bus number explicitly.
- **Separate geofence roles in Event Planning.** Operational-only boundaries
  and messaging-enabled boundaries are shown separately while remaining part
  of one integrated operating period.

## [1.5.32] - 2026-08-13

- **Make the running version easy to find.** The sidebar now presents the
  version as a distinct badge with a clearer “What’s new” action.
- **Keep release notes honest and scannable.** The quick view now selects the
  exact running build instead of assuming the first data entry matches it, and
  the full changelog uses expandable releases with the current build open.
- **Bring the in-app history current.** Missing releases 1.5.8 through 1.5.31
  are now included in the staff-facing changelog.

## [1.5.31] - 2026-08-13

- **Adopt Event Planning Variant E's guided scope canvas.** Operators now
  choose Routes, Geofences, or Transit locations as the primary resource
  workflow, edit one selected resource type at a time, and see the resulting
  Event AVL handoff scope before activation.

## [1.5.30] - 2026-08-13

- **Adopt Event Planning Variant B's scope builder.** Plan details and
  resources now share one workspace with resource cards, add/remove controls,
  readiness counts, and a visible activation gate before lifecycle actions.

## [1.5.29] - 2026-08-12

- **Connect the Event workspace workflow.** Event Planning now presents one
  continuous four-step path from Plan through Configure and Activate to Monitor,
  with the progress rail and next action reflecting the selected operating
  period's lifecycle and no duplicate empty-state prompt.

## [1.5.28] - 2026-08-12

- **Make Event Planning action-oriented.** A prominent next-action panel now
  guides the operator to the exact Event, operating period, resource, review,
  approval, activation, or Event AVL step required next.

## [1.5.27] - 2026-08-12

- **Adopt the Event AVL command-center layout.** The live map now keeps the
  operating brief beside the map, showing visible vehicles, plan membership,
  unassigned vehicles, alert readiness, and a direct Event Planning link.

## [1.5.26] - 2026-08-12

- **Show all active vehicles in Event AVL.** The shared AVL projection no longer
  discards vehicles that are not yet assigned to an Event operating plan.
  Plans still control managed classification and geofence alert processing.

## [1.5.25] - 2026-08-12

- **Align Event Map Authoring with Event AVL.** Authoring now uses prominent,
  labeled active/inactive location markers and independent visibility toggles,
  matching the live-map resource experience.

## [1.5.24] - 2026-08-12

- **Keep active vehicles visible before plan assignment.** Event AVL now shows
  all current SpecialEvent vehicles from shared AVL, while identifying vehicles
  assigned to the selected operating plan and separating unassigned vehicles
  for follow-up.

## [1.5.23] - 2026-08-12

- **Clarify Event AVL locations.** Location points now use prominent haloed
  markers, persistent labels, active/inactive colors, and an on-map legend.

## [1.5.22] - 2026-08-12

- **Show the full Event resource catalog on Event AVL.** Active and inactive
  geofences and transit locations are now available as independent map layers,
  while operational vehicle and alert scope remains limited to the active
  published operating period.

## [1.5.21] - 2026-08-12

- **Make Event AVL scope explicit.** Event AVL now defaults to the most relevant
  Event context and clearly directs operators to repair or activate an operating
  period when its published scope is unavailable.
- **Keep Event workspace navigation coherent.** The Configure stage now opens
  Event Configuration in Admin, and readiness text explicitly requires an active
  SpecialEvent route.

## [1.5.20] - 2026-08-12

- **Connected Event Planning workflow.** Planned routes, geofences, and
  transit locations now appear before the review and activation controls, and
  the lifecycle copy makes the draft → review → approval → activation →
  monitoring path explicit. Activation is identified as the point that
  publishes the validated scope to Event AVL.
- **Reliable Event AVL navigation.** Azure Maps resource-layer cleanup now
  tolerates layers that were already removed or a map that has already been
  disposed, preventing navigation away from Event AVL from blanking the
  console. Added regression coverage for both teardown cases.

## [1.5.19] - 2026-08-11

Closes [#18](https://github.com/mvtamn/mvta-onboard/issues/18).

- **Safer Event switching.** The Event selector now confirms before
  discarding unsaved operating-period edits, matching the period selector;
  fixed the underlying reset so switching Events actually clears stale
  fields instead of leaving them displayed against the wrong Event.
- **Accessible status, not just color.** The activation readiness checklist
  and lifecycle stepper now expose a text-based accessible name per state.
- **Remove a linked resource.** Added a "Remove" action per row in Planned
  operating resources, wired to the `unlinkEventServicePlan` API and backend
  endpoint that already existed but nothing in the UI called.
- **Direction-rule deep link.** The "geofence needs a direction rule"
  readiness item now links to Admin's Configure section with that geofence
  pre-selected.
- **Bulk resource linking.** Route/geofence/location pickers are multi-select;
  adding reports per-kind success/failure/already-linked counts.
- **Duplicate this Event.** Pre-fills the create-Event form from the
  currently selected Event, for recurring events.
- **Searchable Event picker**, sorting still-open Events ahead of fully
  completed ones.
- **One empty-state pattern** instead of two near-duplicate banners; all four
  operating-period panels now number consistently (1.–4.).
- Introduced Vitest + React Testing Library for `onboard-console` (no
  frontend test infrastructure existed before this).

## [1.5.18] - 2026-08-11

- **Clearer Operating period lifecycle panel.** The status stepper, the
  primary next action, the revision sub-workflow, and secondary actions
  (Prepare revision, Suspend) previously read as one flat list of
  same-weight buttons with no signal for which one actually advances the
  plan. The primary action is now visually dominant, secondary actions are
  set apart under an "Other actions" label, and a pending revision now
  renders in its own bordered card instead of blending into the plan's own
  action list.
- **"Suspended" is no longer a fake forward step.** There is no backend
  transition back from suspended to active or completed, so it no longer
  appears as a 6th pill in the linear Draft→Completed stepper (which implied
  a path forward that doesn't exist); it now shows as a distinct paused-state
  callout instead.

## [1.5.17] - 2026-08-11

- **Mobile Event Workspace nav is legible again.** The Plan/Configure/Activate/
  Monitor stage labels were rendering as 1-2 truncated characters on phones;
  the stage list now scrolls horizontally at each stage's natural width, and
  scrolls the active stage into view automatically.
- **Sign Out is reachable on mobile.** The top bar's action row had no wrap
  and no responsive collapse, leaving Sign Out entirely outside the phone
  viewport with no way to scroll to it. It now wraps, and the two least
  essential items (refresh countdown, session date) hide below 860px.
- **No more silent data loss switching operating periods.** Switching the
  operating-period dropdown mid-edit now confirms before discarding unsaved
  name/date changes instead of silently overwriting them.
- **Session-expired is no longer a dead end.** A lapsed session now shows
  "Your session has expired" with a real sign-in action, instead of a
  "Try again" that re-fires the same request and fails identically.
- **Fixed a contrast near-miss** on the Event Workspace stage sub-labels
  (4.4:1 → back above 4.5:1) introduced by an incomplete fix in 1.5.16.

## [1.5.16] - 2026-08-11

- **Safer Event Planning actions.** Activating an operating period for Event
  AVL, suspending it, and applying a revision to the active scope now require
  confirmation; linking a resource already on the plan is blocked with an
  explicit message instead of silently duplicating it.
- **Clearer Event Planning feedback.** Action feedback now renders next to the
  panel that triggered it, styled distinctly for success vs. error, instead of
  one shared banner at the top of the page. The operating-period form only
  appears once an Event is selected.
- **Fixed dark-mode contrast bug.** The active Event Workspace stage (and two
  Event Monitoring success states sharing the same token) referenced an
  undefined `--success-bg` CSS variable, leaving text nearly invisible in dark
  mode; the variable is now defined in both themes and paired with the
  correct foreground color.
- **Mobile-usable console shell.** The left nav sidebar now collapses behind a
  toggle below 860px instead of staying permanently expanded and pushing page
  content off-screen on phones.
- **Tablet layout fix.** The Event Planning setup panels now stack at 768px
  (previously 760px), so the operating-period "Ends" field no longer clips at
  common tablet widths.

## [1.5.15] - 2026-08-10

- **Unified Event operating model.** Added durable Events with generated-event
  migration compatibility, one active Service Plan per Event, and lifecycle
  validation for route, geofence, direction-rule, and date coverage.
- **Shared operational scope.** Event projection, AVL visibility, and crossing
  detection now require the same active-plan operating period instead of route
  classification alone.
- **Clear authoring ownership.** Map Authoring manages reusable resources;
  Event Planning owns Service Plan creation, activation, and revisions.

## [1.5.14] - 2026-08-10

- **Event Monitoring reliability.** Added 90-day telemetry retention, diagnostic
  records, component health reporting, and visible operational status for AVL
  ingestion, event projection, crossing detection, and cleanup.
- **Event Monitoring operations.** Live vehicles now expose their active Service
  Plan scope, while crossing, notification, and audit feeds retain their last
  successful data and surface feed failures.
- **Safer event administration.** Route classifications validate local effective
  date ranges, preserve prior versions, and reject stale edits; geofence updates
  validate geometry and reject conflicting edits.

## [1.5.13] - 2026-08-09

- **Event monitoring resources.** Added admin-managed event locations,
  geofences, direction-aware crossings, notification review, audit history,
  and explicit Service Plans with active-plan gating.
- **Event monitoring UI.** Added geofence crossings, notification review,
  audit history, and service-plan/resource controls to the staff console.
- **Database reliability.** Normal infrastructure redeployments no longer
  rewrite the Key Vault SQL connection secret; intentional SQL credential
  rotation is handled as one coordinated operation.

## [1.5.12] - 2026-08-08

- **Contractor Performance Assessment foundation.** A new top-level Performance
  Assessment workspace provides contractor/month setup, Attachment G standards,
  scorecards, KPI detail, manual metrics, governed occurrence review, manager
  review, recomputation, and finalization. CAP and dispute tabs identify the
  future governed workflows without representing placeholder data as live.
- **Verified missed-trip assessment bridge.** The daily candidate poll copies
  confirmed GTFS and Spare missed trips into the assessment occurrence log
  exactly once. They remain candidates until assessment staff explicitly assign
  contractor-error, excusable, or MVTA-directed attribution; only confirmed
  contractor-error occurrences enter a monthly calculation.
- **Auditable assessment engine and reports.** Assessment inputs are revisioned
  and hashed, changed inputs require manager re-review, finalized reports use
  archived hash-verified HTML, and final issuance uses fail-closed MVTA holiday
  coverage for its dispute deadline. Power BI receives read-only scorecard views.
- **Assessment infrastructure.** The REST Function App is configured for a
  private managed-identity-backed compliance-report container. Database objects
  are defined by rerunnable migrations 030 and 031.

## [1.5.11] - 2026-08-08

- **Missed Trips review queue pagination.** The queue now shows 10 trips by
  default instead of rendering the entire fetched set. Reviewers can choose 10,
  25, 50, or 100 trips per page and move through the results with Previous and
  Next controls in either List or Table layout.
- **Selected-trip context stays usable while reviewing.** The investigation
  panel remains within the viewport, scrolls independently when its evidence is
  taller than the screen, and returns to the top when a different trip is
  selected. Aging and overdue candidates remain visible without automatically
  becoming compliance findings.

## [1.5.10] - 2026-08-08

- **Missed Trips false-positive containment and evidence rebuild.** Schedule-based
  GTFS no-show escalation now defaults paused behind
  `GTFS_SILENT_NO_SHOW_ENABLED`; explicit cancellations remain active. Static
  GTFS service times are converted from `America/Chicago` correctly, including
  past-midnight times, and TripUpdate presence is no longer treated as a trip
  start. TripUpdate/VehiclePosition evidence is retained independently and only
  progress beyond the first scheduled stop establishes underway evidence.
- **Safer Missed Trips review workflow.** Existing detector rows are retained as
  legacy/unverified, reviews require a reason and write append-only history, and
  monthly summaries use agency service date plus source-verified rows. The API
  now separates queue/history, paginates, and reports detector/feed health.
- **Missed Trips console cleanup.** Production API failures no longer fall back
  to plausible sample trips. Review Queue, History, and Monthly views now show
  paused/stale-feed warnings, evidence quality/version, readable dates, review
  history, and load-more controls.
- **Avail/Spare Missed Trips foundations.** Avail time-only start values are
  parsed with their CalendarDate in agency time. A disabled-by-default Spare
  evaluator implements only the three missed-trip conditions from Ridership
  Export + Slots; unattributed cancellations and missing supersession evidence
  remain unknown instead of becoming false candidates. Broader Spare metrics
  are intentionally out of scope.
- **Spare Missed Trips is now a real source pipeline.** A bounded incremental
  job ingests only recently updated Spare Requests and Slots, strips rider PII,
  evaluates completed/cancelled requests with versioned evidence, and projects
  qualified candidates into the shared review queue with a visible Spare source
  and condition breakdown. Rider/no-fault or otherwise unapproved cancellations
  remain data-gap evaluations and never become automatic contractor findings.

## [1.5.9] - 2026-08-07

- **AVL Reports was querying a window five hours in the future, so it returned
  no vehicles at all — the third and final root cause of this feed reporting
  nothing.** The poller built its `{Start DateTime}`/`{End DateTime}` segments
  from UTC components, but Avail360 interprets them in agency-local time.
  Proven from the feed's own response body: a poll sending
  `[2026-08-07 20:45:00 -> 20:55:00]` came back `success: true` with an empty
  array and `RefreshTime: 2026-08-07T15:55:00` — Avail's own "now", exactly
  UTC-5 (CDT) behind what we asked for. An out-of-range window is reported as
  an empty result rather than an error, which is how this survived the two
  earlier fixes (the 404 URL shape in 1.4.x and the `%3A`-escaped colons on
  2026-08-06). The window is now formatted in `America/Chicago`, which handles
  the CDT/CST switch without a hardcoded offset; new tests pin both offsets
  against the same UTC instant so neither a UTC revert nor a fixed `-5` passes.
- Consequence for the console: **Event Monitoring and Admin > Route
  Classification's `(AVL)` list should start populating** once the next poll
  runs — both were empty for want of vehicle data, not because of a bug in
  either page. Note the discovery list still reflects only what is running at
  that moment (positions are stored latest-only per vehicle), so classify
  special service while it is actually out.

## [1.5.8] - 2026-08-07

- **Admin > Route Classification's Route ID picker no longer lists only GTFS
  routes.** The picker was built solely from the GTFS schedule, which by
  definition cannot contain a special-service RouteID — so the routes this
  editor exists to classify were the exact ones it would not offer. The list
  now merges in RouteIDs seen in live AVL data, marked `(AVL)` and carrying
  their best-effort label (e.g. "1111 · Vikings Game Shuttle"); a RouteID
  appearing in both lists is shown once.
- **A RouteID in neither list can now be entered at all.** The free-text
  RouteID input was only reachable when the GTFS route registry came back
  empty, so in practice it never appeared — making a brand-new event RouteID
  that has not run yet (in neither GTFS nor AVL data) impossible to classify.
  It is now always available alongside the picker.

## [1.5.7] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.6, all still awaiting a deploy.

- **Missed Trips' new Trip/Route/Direction table (1.5.5) is now an addition
  to the flagged-trip list, not a replacement of it.** 1.5.5 converted the
  whole list to a table; that took away the original card-row list (Service/
  Detection/Review) some staff were already using. There's now a "List /
  Table" toggle next to "Flagged trips" — List is the original card layout,
  unchanged, driving the detail pane beside it; Table is the new full-width
  Trip/Route/Direction/Detection/Review view from 1.5.5, for scanning many
  rows at once. Picking a row in Table mode switches to List mode with that
  trip already selected, so it's a shortcut into investigation, not a dead end.

## [1.5.6] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.5, all still awaiting a deploy.

- **Event Monitoring now names event buses instead of showing a bare route
  number.** The map popups and the event-bus table resolved route names from
  the GTFS static schedule, which by definition cannot contain a special-event
  RouteID — so every event bus read "Route 1111" even when an admin had
  entered a name like "Vikings Game Shuttle" under Admin > Route
  Classification. Route identity now comes from Route Classification (the
  `route_label` an admin actually typed), with GTFS kept only as a fallback
  for a regular fixed route temporarily classified as SpecialEvent.
  `GET /event-vehicle-positions` returns `route_label`/`route_category`
  alongside the position fields to make this possible.
- `plans/route-classification-explained.md` documents the full
  AVL Reports → classification filter → position tables → map chain, and why
  position alone is insufficient: an event map of unlabeled dots can't tell
  an operator which shuttle is which.

## [1.5.5] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.4, all still awaiting a deploy.

- **Missed Trips' flagged-trip list is now a real table, led by a
  Trip/Route/Direction identifier instead of the raw GTFS trip_id.** Staff
  read Avail's own reports by scheduled-time + direction (e.g. "1245-SB"),
  not by an opaque static-feed key like `t52C-b2E-sl2B-v62` — the list (and
  the detail panel's header) now show that same time+direction code, with a
  new Direction column (NB/SB/EB/WB, sourced from `GtfsTripDirections` via
  a join added to `GET /missed-trips`) alongside Trip/Route/Detection/Review.
  The raw trip_id is still shown as a de-emphasized "Ref" in the detail
  panel for support/debugging. A Block column is deferred — `trips.txt`'s
  `block_id` isn't parsed or stored anywhere in this system yet, which needs
  its own migration and static-sync change before it can show up here.

## [1.5.4] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.3, all still awaiting a deploy.

- **Missed Trips investigation queue no longer shows resolved trips.**
  Rows where the vehicle eventually departed within the grace window
  (`status: "resolved"`) were piling up in "Flagged trips" alongside the
  small number of rows actually needing staff attention — nothing about a
  resolved row needs investigation, so it's noise. The list, its route/date
  filters, and the summary counts (Unreviewed/Confirmed/False
  positives/Routes affected) now all read from the non-resolved subset;
  resolved history remains visible on the Monthly Assessments tab.
- **"Missed" badge renamed to "Potential missed" until a reviewer
  confirms it.** A detection hit is a candidate, not a certainty — showing
  a flat red "Missed" badge before any human review overstated confidence.
  The badge now reads "Potential missed" (amber) while `validation_status`
  is `unreviewed`, and only escalates to "Missed" (red) once a reviewer
  records it as `confirmed`.
- **Relative-time labels now switch to hours once past 60 minutes** (e.g.
  "4h 10m ago" instead of "250 min ago") in the Missed Trips list.

### Detour date handling — three bugs, one root cause

Surfaced immediately by real Avail-synced detour data.
`Detours.start_date`/`end_date` are SQL `DATE` columns, and the mssql driver
returns those as JS `Date` objects — which JSON-serialize to a full ISO
timestamp (`2026-08-08T00:00:00.000Z`), not the plain `YYYY-MM-DD` string
every consumer assumed. `detourStatus.ts`'s own header comment asserted the
opposite ("SQL DATE columns serialize this way"), which is how it went
unnoticed, and every existing test fed it hand-written `YYYY-MM-DD` strings,
so none of them could catch it.

- **No detour ever showed as Active.** `computeDetourStatus` compared a
  `YYYY-MM-DD` string against a `Date`, which coerces to `NaN` — false in
  *both* directions, so `today < start_date` and `today <= end_date` were
  both false for every row, and every detour fell through to "Recently
  finished" regardless of its dates. A closure running Jul 6 → Oct 31 was
  reported as finished on Aug 7. The status tabs, the reports page and any
  future "active detours only" query were all wrong together — exactly the
  single-source-of-truth property that function exists to provide.
- **Editing a detour would have silently wiped its dates.** `<input
  type="date">` accepts `YYYY-MM-DD` and nothing else; handed an ISO
  timestamp it reads back as the empty string and renders blank. Opening
  Edit on a detour with dates and pressing Save wrote `null` over both.
  This one predates the reporting work — it has been live since B2.
- **Date columns rendered raw ISO timestamps** in both detour tables.
- Fixed at the boundary: `toDateOnly()` in `detourStatus.ts` normalizes
  whatever the driver produced, `computeDetourStatus` normalizes before
  comparing, and `GET /detours` now emits `start_date`/`end_date` as plain
  `YYYY-MM-DD` so the contract the rest of the app assumed is finally true.
  The console keeps its own defensive parsing (`lib/detourDates.ts`) rather
  than trusting that. New tests pin the shapes the driver actually returns —
  `Date` objects and ISO strings — instead of only the hand-written strings
  that hid this.
- Detour dates are now formatted in **UTC**. They are service days, not
  instants; building them at local midnight shifted them a day earlier for
  anyone west of Greenwich.

### Detour reporting polish

- **The reporting line no longer renders as a row of dashes.** "Reported by
  — (—) · Approved by — (—)" appeared on every detour with no reporting
  detail recorded — which is all of them so far — and pushed the useful
  provenance down the panel. Reported and Approved now each render only when
  something was actually recorded.
- **Who created a detour is now visible**: a "Created by" column on Detour
  Reports, and a clearer created/last-edited line in both detail panels.
  Avail-synced rows read "Avail sync" rather than showing staff a service
  identity they'd have to decode.

## [1.5.3] - 2026-08-07

Not yet deployed. The deployed console is still on 1.5.0 — 1.5.1, 1.5.2 and
1.5.3 are all awaiting a deploy.

**`migration-025-detour-reporting-fields.sql` has been run against the dev
DB (2026-08-07); the code is not yet deployed.** Unlike migration-024 there
is no backfill gap — every new column is optional, so detours created
through the currently-deployed build are simply uncategorized and can be
filled in afterwards. Every surface below degrades gracefully anyway: the API
guards on `COL_LENGTH('dbo.Detours', 'reason_code')` and drops the new
fields rather than failing, `GET /detour-reason-codes` returns an empty list
rather than 500ing, and the console hides the whole reporting section rather
than letting staff type into fields whose data would be silently discarded.

- **Detour reporting fields (Part B6).**
  `migration-025-detour-reporting-fields.sql` adds a `DetourReasonCodes`
  table (mirroring `OtpReasonCodes`, minus `applies_to` — it has only one
  consumer) plus ten columns on `Detours`: `reason_code`, `severity`,
  `reported_by`/`reported_at`, `approved_by`/`approved_at`, three more
  notification-channel flags (`radio_notified`, `dispatch_board_notified`,
  `social_media_notified`) and `resolution_notes`. **Every field is a draft
  built from standard transit-ops practice, not from MVTA's real internal
  detour-reporting form, which no document in this repo describes.** They
  were approved as-drafted with that caveat explicit; expect to correct them
  against the real form. Nothing requires any of them, so a wrong column can
  be dropped without breaking existing rows. `reason_code` is a soft
  (non-FK) reference to `DetourReasonCodes.code`, same convention as
  `OtpStopExclusions.reason_code`, so retiring a code can't orphan the
  history citing it — which is also why `code` is deliberately not editable
  via `PATCH /detour-reason-codes/{id}`.
- **New endpoints**: `GET /detour-reason-codes` (any detour-reading role,
  including `OCC.Compliance` and `OCC.Detour`, neither of which is in
  `STAFF_READ_ROLES`), `POST`/`PATCH` (admin only — this is a controlled
  vocabulary, not day-to-day entry).
- **"Clone as new detour"** on the Detours list. A single real notice
  routinely bundles two separately-dated sub-closures — the Aug 2026 ramp
  notice covered the Cliff Rd and Diffley Rd ramps on different dates —
  which is two `Detours` rows sharing everything but their dates. Clone
  copies the shared context and deliberately drops what must not be
  inherited: dates, every notification flag, the approval, and resolution
  notes.
- **New read-only "Detour Reports" page (Part B7)** for compliance and ops
  leadership: free-text search, filters (status, reason category, severity,
  source, start-date range), and a client-side CSV export of whatever is
  currently on screen. It reads the same `GET /detours` payload and the same
  server-computed status as the entry page, so the two can't disagree about
  whether a detour is Active. There are no edit controls anywhere on it,
  even for users who have those rights on the entry page. Search and
  filtering are **client-side** — `GET /detours` returns every non-deleted
  row and there is no pagination; `lib/detourSearch.ts` is the single seam to
  move server-side if real volume ever makes a full scan slow.
- **A plain search box on Detours & Closures**, using that same matcher.
  Terms are ANDed across number, internal reference, closure text, riders
  directed, segment routes and directions, staff names, and the reason
  code's human *label* — so typing "special event" finds rows stored as
  `special_event`.
- **Sidebar: "Detours & Closures" moved into the existing "Tools" group**,
  alongside the new "Detour Reports", OCC Tools and Compliance, rather than
  sitting flat among the rider-message primaries. The group header now
  renders if any child does, so an `OCC.Detour`-only user sees a labelled
  group instead of two orphaned links.

## [1.5.2] - 2026-08-07

Not yet deployed. The deployed console is still on 1.5.0 — both 1.5.1 and
1.5.2 are awaiting a deploy.

- **New `OCC.Detour` role, and a fix for a live 403.** Detour access now has
  four explicit tiers in `auth.ts` (`DETOUR_READ_ROLES`,
  `DETOUR_WRITE_ROLES`, `DETOUR_DELETE_ROLES`,
  `DETOUR_ATTACHMENT_WRITE_ROLES`) instead of inline role spreads, because
  that drift is what caused the bug: `OCC.Compliance` sat in `App.tsx`'s
  detour nav constant but in none of the API's read roles, so Compliance
  users could open the Detours page and then get a 403 from `GET /detours`.
  Compliance now has read access (it needs detour history for reporting) and
  no longer has attachment writes, which it previously had *without* detour
  edit access - contradicting B3's rule that attachments sit at the edit
  tier. The new `OCC.Detour` role can read, create, edit and attach, but
  deliberately **cannot delete**; soft-delete stays at the publisher tier.
  The role is **additive** - existing roles keep the access they had, so
  nothing goes dark at deploy. **`OCC.Detour` does nothing until it is
  registered as an `appRole` on the Entra app registration and assigned per
  user** - the code only teaches both sides to recognize the claim.
- **Internal detour numbering (Part B10)**: every detour created through
  `POST /detours` now gets a system-generated `MVTA-DET-YYYY-####` reference
  (`migration-024-detour-numbering.sql`), separate from the existing
  staff-entered free-text `number` field, which is unchanged. `####` resets
  each year, taken from the detour's `start_date` (falling back to the
  current year for open-ended detours). Allocation is a single atomic
  `MERGE ... WITH (HOLDLOCK)` against a new `DetourNumberSequences` table, so
  bootstrapping a new year and incrementing an existing one are the same
  statement - a `SELECT`-then-`INSERT` bootstrap would have raced on Jan 1,
  and a naive `MAX()+1` would have collided on any concurrent create.
  `internal_number` ships **nullable** with an in-migration backfill of
  existing rows (in `created_at` order per year), seeding the sequence table
  from what the backfill consumed so the first new detour doesn't collide
  with a backfilled number; tightening to `NOT NULL` is deliberately left to
  a later migration. Numbers are never reused or reassigned, including for
  soft-deleted rows. A detour rescheduled into a different year keeps its
  original number - it may already be quoted in a sent email - and the
  console shows an inline warning rather than letting the year read wrong.
  Both `detoursCreate.ts` and `detoursList.ts` guard on the column existing,
  so nothing breaks before migration-024 runs.
- **Fixed a latent 403 that would have broken the first-ever detour image
  upload.** `blobStorage.ts` requested a user-delegation key valid for
  exactly `SAS_EXPIRY_MINUTES`, then minted a SAS for the same duration
  measured from a `now` captured *after* that network round-trip returned -
  so the token always expired slightly after the key that signed it, which
  Azure rejects outright. The key window now deliberately outlives the SAS
  (`DELEGATION_KEY_EXTRA_MINUTES`), and both windows are back-dated
  (`CLOCK_SKEW_MINUTES`) so a few seconds of clock skew can't produce a
  not-yet-valid token either. Both failure modes are invisible until Blob
  Storage is actually provisioned, so the window math is now unit-tested
  (`sasWindow`). `getUploadSasUrl`/`getReadSasUrl` were near-identical and
  now share one `buildSasUrl` helper.
- **Detour image uploads would also have failed CORS.** The upload/read SAS
  URLs point straight at Blob Storage, bypassing the Function App, so the
  storage account needs its own CORS rules - `storage-detour-images.bicep`
  takes `allowedCorsOrigins` for exactly that, but
  `phase1-dev.parameters.json` never set the parameter, leaving it `[]` (no
  cross-origin browser access at all). Now set to the dev Front Door
  endpoint. Note this parameter also feeds the Function App's own CORS.
- **Corrected stale detour documentation.** `HANDOFF.md` still described the
  Avail Detours envelope key as an unverified guess (`result.Detours`) and
  the sync as uncommitted/undeployed; the key was confirmed live as lowercase
  `result.detours` on 2026-08-05 and the sync is committed. It also called
  image attachments "live" when they can't be until Blob Storage exists.
  `availDetoursFeed.ts`'s own fallback diagnostic still named the wrong
  (capital-D) key in its error text.
## [1.5.1] - 2026-08-07

Not yet deployed.

- **Fixed two missed-trip detection logic gaps in `gtfsMissedTripsPoll.ts`.**
  (1) The silent-no-show grace threshold was 15 minutes; ops' definition of
  a missed trip is "never ran, or started more than 30 minutes late" - bumped
  `GRACE_MINUTES` to 30 to match, used consistently for both the no-show
  cutoff and the late-arrival resolve check below. (2) Confirmed boundary
  bug: the no-show cutoff compared against wall-clock seconds-since-midnight
  (always `< 86400`), so any trip scheduled after ~23:45, or using GTFS's
  standard `>24:00:00` past-midnight time notation, could never satisfy the
  cutoff on any poll run and silently fell out of detection scope forever
  once the calendar date rolled over. `detectSilentNoShows` now runs twice
  per poll - once for "today", once for "yesterday" with elapsed time
  uncapped past 86400 - closing the gap without a separate rollover job
  (existing `NOT EXISTS` filters keep the repeat check a no-op once a trip
  is observed or tracked). Also fixed `resolveLateArrivals`, which
  previously flipped a flagged trip straight to `resolved` the instant it
  appeared in `GtfsObservedTrips` at all, with no check on how late - a
  trip starting 90 minutes late was silently reclassified as a non-event.
  Now split into two updates: arrivals within the 30-minute grace period
  resolve normally; arrivals beyond that stay flagged as missed but record
  `detected_late_arrival_at` so staff can see it eventually ran. See
  `plans/missed-trip-detection-logic-gaps.md` for the full writeup,
  including an open, not-yet-root-caused false-positive hypothesis these
  fixes don't address.
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
