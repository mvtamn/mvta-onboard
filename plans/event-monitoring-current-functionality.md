# Event Monitoring — Current Functionality

Last updated: August 9, 2026

Describes what is built and running today. For what was *intended*, see
`event-module-implementation-plan.md`; where the two differ, this document is
authoritative and the differences are called out in "Deviations from the plan".
Much of the geofencing, notification, and service-plan code was developed in
Codex and differs in style from the rest of the repo.

## Purpose and access

The event module spans three console surfaces:

- **Event Monitoring** (`/console/event-monitoring`) — live map, vehicle list,
  geofence-crossing feed, notification review queue, and audit view.
- **Event Planning** (`/console/event-planning`) — service-plan lifecycle: create
  a draft, link routes/geofences/locations, walk it through review and approval to
  active.
- **Admin > Event Map Authoring** — draw geofences and place reference locations
  on the map, author direction rules, and set the AVL polling interval.

It does not publish rider alerts or change vehicle assignments. It **does** send
Teams notifications on geofence crossings, either after staff approval or
automatically for rules explicitly marked `auto`.

| Surface | Required role |
|---|---|
| `/event-monitoring` and `/event-planning` routes, nav links | `OCC.Admin` |
| `GET /event-vehicle-positions` | `OCC.Admin` |
| `GET /maps/token` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance` |
| `GET /route-classification` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance` |
| `PUT`/`DELETE /route-classification/{routeId}` | `OCC.Publisher`, `OCC.Admin`, `System.Ingestion` |
| `GET`/`PATCH /app-settings` | `OCC.Admin` |
| `GET /event-geofences`, `GET /event-locations` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance` |
| `POST`/`PATCH` on geofences, rules, locations | `OCC.Admin` |
| `GET /event-geofence-crossings` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance` |
| `GET /event-geofence-notifications` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin` |
| `POST /event-geofence-notifications/{id}/send` and `/dismiss` | `OCC.Publisher`, `OCC.Admin`, `System.Ingestion` |
| `GET /event-service-plans` and all plan actions | `OCC.Admin` |
| `GET /event-module-audit-stream` | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance` |

## Which vehicles are monitored

A vehicle appears on the page only when all of the following are true:

1. Its route is classified as `SpecialEvent` in Admin > Route Classification.
2. The classification is active **and** its optional effective dates include
   today.
3. The vehicle has reported within the last three minutes.
4. Its coordinates fall within the configured MVTA operating-region bounds
   (latitude 43.0–46.0, longitude -95.5–-92.0).

Conditions 2–4 are enforced by the read query in `eventVehiclePositions.ts`. The
ingestion side is looser: the poller selects routes on `is_active = 1` alone and
ignores effective dates, so positions for a date-expired classification are still
written to the event tables — they are simply filtered out on read.

## Ingestion

Event positions are **not** collected by a dedicated event poller. They are a
side-effect of the shared Avail AVL poller, `availAvlPoll.ts`:

- The timer wakes every 15 seconds (fixed CRON; Azure timers cannot be
  rescheduled without a redeploy).
- Each wake-up attempts a conditional `UPDATE` against `AppPollState` for
  `module = 'event'`. The update succeeds only if the configured interval has
  elapsed, which both paces the poll and acts as a database-backed lease so a
  scaled-out Function App polls once, not once per instance. If it does not
  succeed, the invocation is a no-op.
- The effective interval comes from `AppSettings` (`module = 'event'`,
  `setting_key = 'poll_interval_seconds'`), default 30, clamped server-side to
  15–300 seconds. It is editable in Admin > Event Monitoring Settings without a
  redeploy.
- Each due run fetches a trailing two-minute window from Avail AVL Reports, so a
  delayed report is picked up by the following poll rather than lost.
- Every mapped report is upserted into `AvailAvlVehiclePositions`. Reports whose
  route is `SpecialEvent`-classified additionally upsert
  `EventVehicleCurrentPosition` and append to `EventVehiclePositionHistory`.
- Rows are deleted from `EventVehicleCurrentPosition` when their report is older
  than three minutes **or** their route's `SpecialEvent` classification is
  removed or deactivated. `EventVehiclePositionHistory` is never pruned.

Degraded modes are silent and non-fatal by design:

- `AppSettings`/`AppPollState` missing → no pacing gate at all; the poll runs
  every 15 seconds.
- `RouteClassification` missing → the event write is skipped; the all-vehicle
  poll is unaffected.
- `EventVehicleCurrentPosition` missing → the API returns an empty vehicle list
  with `table_ready: false`, and the page shows "Event vehicle monitoring has not
  been configured yet."

**Operational consequence:** because the interval gate wraps the whole poll,
`event.poll_interval_seconds` governs the refresh cadence of the general
all-vehicle `AvailAvlVehiclePositions` table too — not just event vehicles. Every
consumer of that table (the AVL Reports view, detour last-seen) speeds up or
slows down with this one setting, and the Avail API call volume scales with it
around the clock, not only during events.

## Live map

- Azure Maps, road view by default. The browser never holds a Maps key; the SDK
  fetches a short-lived AAD token from `GET /maps/token` and re-fetches on expiry.
- Selectable styles: Road, Light (grayscale), Night, Satellite + labels.
- A single **Traffic** checkbox enables flow and incidents together.
- Each filtered vehicle renders as a bus marker rotated to its reported heading.
- Hover or click a marker for operator, vehicle, route, cardinal heading, speed,
  and report age.
- **Open larger map** opens the map's current center and zoom in a new Bing Maps
  window. Nothing else on the map opens a window.
- The camera fits to the first non-empty vehicle set, once per map instance.
  Subsequent 30-second refreshes move markers without disturbing the operator's
  pan or zoom.
- Minimizing the map **destroys the map instance**; restoring builds a new one at
  the default center (44.83, -93.25) and zoom 10, then re-fits on the next data
  arrival. Any manual pan or zoom is lost across a minimize/restore.

## Summary tiles

Three counts sit above the workspace and are **not** affected by the filters:

- **Vehicles** — all classified, fresh, in-bounds vehicles returned by the API.
- **Routes** — distinct routes among them.
- **Reporting now** — how many reported within the last 60 seconds.

## Filters

The map and the table always render the same filtered set. Available filters:

- Free-text search across vehicle number, formatted operator name, and route
  number/label
- Special-event route
- Heading: NB, SB, EB, or WB
- Motion: moving (≥ 1 mph), stopped (< 1 mph), or both

Motion filtering is speed-dependent: a vehicle whose speed could not be
determined is excluded from **both** "Moving" and "Stopped", and is visible only
under "Moving + stopped".

The count above the table reads `N active`, and `N of M active` only while a
filter is applied. **Clear filters** appears only when a filter is set; it resets
the four operational filters and leaves the map style and traffic layer alone.

## Vehicle details and data sources

| Field | Source | Behavior and caveats |
|---|---|---|
| Vehicle, route, coordinates, heading, report time | `EventVehicleCurrentPosition` (Avail AVL Reports) | Required for a marker |
| Friendly route name, monitoring eligibility | `RouteClassification` | Active `SpecialEvent` rows whose effective dates include today |
| Block, run, raw direction | `AvailAvlVehiclePositions`, joined on vehicle **and** route | Blank if the vehicle's current AVL row is on a different route; `0` normalizes to unavailable |
| Operator | `FixedRouteDepartures` (Avail Pullout Reports) | Matched on block+run **or** numeric vehicle label, within the last two service days, most recent first. Reported as source `Avail Pullout Reports` |
| Speed | `MonitoredTripDelays.speed_mps` (GTFS-Realtime derived), matched on vehicle id within the last 3 minutes | Falls back to distance ÷ time between consecutive `EventVehiclePositionHistory` reports, only when that gap is 5–300 seconds; otherwise blank |
| Cardinal heading | AVL heading degrees, else AVL direction letter | Degrees win when present. Letters map N/NB→NB, S/SB→SB, E/EB→EB, W/WB→WB, plus **O→EB and I→WB** (Avail outbound/inbound) |
| Operator display name | Derived | Trailing ` -1234` id is stripped and `Last, First` is reordered to `First Last` |

## Known data limitations

- Avail AVL and GTFS-Realtime vehicle identifiers are not guaranteed to match, so
  the primary speed source can silently miss.
- Special-event pullout assignments may not appear in the fixed-route Pullout
  Reports feed at all.
- Some AVL records report route, block, or run as zero/null.
- Operator shows `Operator unavailable` when neither block/run nor vehicle label
  yields a Pullout Reports assignment. The application does not infer or fabricate
  names.
- The `O→EB` / `I→WB` mapping treats Avail's inbound/outbound flags as compass
  directions. It is a convenience for the heading filter, not a verified
  correspondence, and is only used when heading degrees are absent.
- A future operator-assignment feed can be added as another server-side
  enrichment source without changing the map or table contract.

## Refresh and error behavior

- The browser polls `GET /event-vehicle-positions` every 30 seconds and offers
  **Refresh now**. This UI interval is fixed in the frontend and is independent of
  the Admin-managed server ingestion interval — the two can drift, so a displayed
  position may be up to one ingestion interval older than the refresh time
  suggests.
- The latest successful UI refresh time is displayed. The crossings, notification
  queue, and audit views reload off that same timestamp, so they follow the
  30-second vehicle refresh; a failure to load them is swallowed silently and
  leaves the previous contents on screen.
- Feed, authentication, map-token, and API failures surface as explicit status
  messages; a map-token failure degrades the map only, leaving the table live.
- When nothing matches classification, freshness, and bounds, the page states
  that no active vehicle matches the current `SpecialEvent` classifications.

## Geofences, locations, and direction rules

Authored in **Admin > Event Map Authoring** on an Azure Maps surface with the
SDK's own drawing toolbar (`azure-maps-drawing-tools`).

- **Geofences** are GeoJSON polygons drawn on the map (`EventGeofences`). They can
  sit anywhere — lots, venues, corridor checkpoints — not only at endpoints.
  Reshaping an existing polygon auto-saves after a 500 ms debounce. "Deactivate
  boundary" (the erase tool) sets `is_active = 0` rather than deleting.
- **Locations** are single points with a category (`transit_station`, `venue`,
  `park_and_ride`, `other`) placed with the point tool (`EventLocations`). They
  render as markers and can be referenced as a rule's destination.
- **Direction rules** hang off a geofence (`EventGeofenceDirectionRules`): a
  transition (`enter`/`exit`), a heading range in compass degrees (wraparound
  supported, e.g. 350→10), a free-text destination label, an optional
  `destination_location_id`, a `send_mode` of `manual` or `auto`, and a
  `sort_order`.
- Layer checkboxes toggle geofences and locations independently, and the pointer's
  live latitude/longitude is displayed while authoring.

Map authoring requires an active Microsoft session; if the token call returns 401
the pane offers a re-sign-in rather than failing silently.

## Crossing detection

Runs at the end of each due AVL poll cycle (`lib/eventGeofenceDetection.ts`,
invoked from `availAvlPoll.ts`), so detection latency is bounded by the same
Admin-managed interval — 15 to 300 seconds, default 30. A failure here is caught
and logged; it never fails the ingestion run.

1. Candidate vehicles are event positions from the last three minutes whose route
   is linked to an **active** service plan.
2. Candidate geofences are `is_active` fences linked to an **active** service plan.
3. Each vehicle is tested against each fence with a hand-written ray-casting
   point-in-polygon function (`lib/geofence.ts`; no external geometry
   dependency). Only the polygon's outer ring is considered — holes are ignored.
4. `EventGeofenceVehicleState` holds last-known inside/outside per vehicle+fence.
   A row is written on first sight but **no crossing is emitted** until the state
   actually flips, so a vehicle already inside a fence when first seen does not
   produce a false "enter".
5. On a flip, the vehicle's heading is matched against that fence's rules for the
   matching transition, and a row is written to `EventGeofenceCrossings` with the
   matched `destination_label` or NULL. A crossing that matches no rule is still
   recorded as a plain enter/exit.
6. The crossing id is published to the `event-geofence-notifications` Service Bus
   queue, so a slow Teams post never delays the next poll.

## Notification review

`eventGeofenceNotify.ts` consumes the queue, re-derives the matching rule, and
drafts a message of the form
`Event vehicle {id} {enter|exit}ed {geofence}; {destination label}`.

- **Manual** (the default): the draft lands in `EventGeofenceNotifications` as
  `pending` and appears in Event Monitoring's review queue with Approve and
  Dismiss actions. Approving posts to the Teams webhook and stamps `sent_by` and
  `sent_at`; if `TEAMS_EVENT_WEBHOOK_URL` is unset the approval returns 503, and a
  webhook rejection returns 502.
- **Auto**: the message is posted immediately with no human step and recorded with
  `sent_by = NULL`. A rule marked `auto` is recorded as `manual` whenever the
  webhook is not configured.

## Service plans

Event Planning (`/console/event-planning`) is the activation layer. Geofences,
locations, and classifications are evergreen; a plan is what declares a set
genuinely in service.

- Lifecycle: **draft → review → approved → active → completed**, plus **suspended**
  from active. Each step is an explicit action; no plan activates on a date alone.
- Resources can be linked only while a plan is in `draft` or `review`.
- Activation is refused unless the plan has at least one route **and** one
  geofence linked — enforced both in the UI and server-side (409).
- Transitions are guarded server-side: each action only applies to a plan in the
  expected prior state, otherwise 409.

## Audit stream

`GET /event-module-audit-stream?from=&to=` merges three sources by timestamp —
`RouteClassification` edits, geofence crossings, and notification sends and
dismissals — following the project's "the record is the audit trail" convention
rather than a separate log table. Defaults to the last seven days. Surfaced as a
history view in Event Monitoring.

## Deviations from the plan

`event-module-implementation-plan.md` A2 specified a **new, separate**
`eventAvlPoll.ts` and stated that `availAvlPoll.ts` would remain untouched at its
5-minute cadence "for the general fixed-route AVL feed other parts of the system
depend on staying at that cadence." As built, that separation does not exist: the
event filtering lives inside `availAvlPoll.ts` and the general AVL feed now runs
on the event module's configurable interval. See the operational consequence
noted under Ingestion.

Three smaller divergences: A6's lifecycle grew from the planned three states to
six (migration-035); Service Plans became their own `EventPlanning.tsx` page
rather than an `Admin.tsx` section; and A5 became its own
`eventModuleAuditStream.ts` rather than an extension of `otpAuditStream.ts`.

## Known gaps

- **The active-plan gate is not applied everywhere it is claimed.** Crossing
  detection gates on an active plan, but the poller's event write
  (`availAvlPoll.ts`) and the live-map read (`eventVehiclePositions.ts`) do not —
  they act on any active `SpecialEvent` classification. Both the Admin and Event
  Planning pages tell staff that only active-plan resources participate in
  polling. Positions are in fact collected and displayed without any plan.
- **Only one direction rule per transition is ever evaluated.** Detection selects
  `TOP 1` rule ordered by `sort_order` and then heading-matches it, so if that one
  rule's heading range does not match, no rule matches — the remaining rules on
  the fence are never consulted.
- **Location Rename and Deactivate do not work.** The `PATCH /event-locations/{id}`
  handler replaces all fields and never reads `is_active`, while the UI sends
  partial bodies. Both actions error out, with no message shown to the user.
- **Approving the same notification twice can double-post to Teams.** The webhook
  POST happens before the status is claimed, so concurrent approvals both send.
- **A notification can record `sent` when delivery failed.** The auto path stamps
  `sent`/`sent_at` in the insert, before the webhook result is known.
- **Every crossing creates a notification**, including ones matching no rule, with
  no dedup, throttle, or expiry — several corridor fences across a bus fleet will
  fill the manual queue quickly.
- **`EventGeofenceVehicleState` is never purged**, so stale inside/outside state
  can survive plan completion and produce a phantom transition at the start of a
  later event.
- **Deleting a linked route classification now fails.** Migration-034's foreign key
  from `EventServicePlanRoutes` means the hard delete added for undoing test
  classifications returns a generic 500 for any route linked to a plan.
- **Effective dates are unreachable from the UI.** `PUT /route-classification/{routeId}`
  writes `effective_start_date`, `effective_end_date`, and `is_active` on every
  save, but the Admin editor submits only category and label — so editing any
  classification nulls its effective dates and forces it active. Effective dating
  works only for rows written directly against the API or database.
- **`EventVehiclePositionHistory` has no retention policy.** It is append-only
  with no purge job, growing one row per event vehicle per poll cycle.
- **The poll-interval control does not disclose its blast radius.** Admin >
  Event AVL Settings presents `poll_interval_seconds` as an event tunable while it
  in fact paces all Avail AVL ingestion — and, now, geofence-crossing latency.
- **Detection cost scales as vehicles × geofences.** Each pair issues three
  sequential queries inside the ingestion invocation.
- **Thin test coverage.** `lib/geofence.test.ts` covers the two pure helpers; the
  crossing state machine, notification paths, and plan transition guards are
  untested.
