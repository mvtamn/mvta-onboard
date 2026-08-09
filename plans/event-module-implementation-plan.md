# Implementation Plan — Route Classification + Event Bus Monitoring

## Context

Driven by **`OTP-Feed-Evaluation-and-Recommendation (2).md`** — a superset of the doc already implemented (see `CHANGELOG.md`'s OTP Compliance entry). Its OTP Monthly / Missed Trips feed content is unchanged from the original - that work stands as-is, no rework needed. It adds three new sections: confirmed `{Property}=MVTA` (already used everywhere), a **route classification problem** (`RouteID` in every Avail feed is a bare number with no fixed-route-vs-special-event flag), and a **new use for AVL Reports**: real-time tracking of *special event* buses specifically for the still-unbuilt Event Module (`MVTA_ONBOARD_MANUAL.md` §18, `Special_Event_Vehicle_Monitoring_Module_1.docx` - "fully specified, still unbuilt").

**Research findings that shape the approach:**
- No "User Admin" role exists in this codebase (`auth.ts`'s `STAFF_READ_ROLES`/`PUBLISH_ROLES`/`ADMIN_ROLES`, or the frontend's `AppRole` union) - it's brief-author terminology, not existing plumbing. Reuse the existing 4 roles (`OCC.Viewer`/`OCC.Publisher`/`OCC.Admin`/`System.Ingestion`) plus `OCC.Compliance` - no new role needed for this workstream.
- `availAvlPoll.ts` already fetches **every** vehicle from AVL Reports every 5 minutes and upserts into `AvailAvlVehiclePositions` (`vehicle_id`-keyed, no route filtering at all) - confirmed via full file read. This matters for Part A below.
- `GtfsRoutes.route_type` (migration-010) is the **standard GTFS mode enum** (all 20 seeded MVTA routes are `3` = bus) - not a fixed-route/event distinction. No existing table classifies routes by fixed-route-vs-event.
- The new doc's AVL Reports URL shape (`GET /{Property}/{Start DateTime}/{End DateTime}`) doesn't match the already-built `availAvl.ts`'s single-date URL (`GET /{Property}/{date}`, confirmed against the owner's own real endpoint earlier this project). **This is a genuine, unresolved discrepancy between the doc's spec sheet and reality** - not something to guess past. Addressed below by not building a second, separately-shaped AVL fetch at all (see A2).
- Highest existing migration is `migration-015-avail-missed-trips.sql`; next is `016`.
- `db.ts`'s `getPool()`/`sql` export pattern, `Compliance.tsx`/`OccTools.tsx`'s `TOOLS` array + switcher pattern, and `App.tsx`'s `PAGE_META`/`NavLink`/`RequireRole` pattern are all confirmed and reused directly below.
- MVTA's real Avail Planning & Scheduling route list already follows a naming convention for non-fixed-route service: `Special1111`, `Special2222`, `Special3333`, `Special8888`, `Special BTS`, plus `Rescue Bus`, `Pivot`, `Reserved Pivot`, `Maintenance`, `Training`. This is leveraged in A1 below to pre-fill classification suggestions rather than requiring a blank-form entry per route.

---

## A0. User story (redraft — supersedes the original mock scenario)

> As an OCC staff member monitoring State Fair shuttle service, I want to see the real-time locations of buses running special-event routes plotted on an actual Twin Cities-area map, with fixed-route buses filtered out, so that I can reference where each shuttle is along its travel pattern between the park-and-ride lots and the fairgrounds.

This intentionally narrows the module's Phase 1 scope to visibility/reference only. `StaffAssignments`, `Events`, `PredictedDelays`, and any Alerts/publish pipeline (Manual §18's full design) remain explicitly out of scope for this pass — see "Explicitly out of scope" below. This is a deliberate, standing scope boundary, not a placeholder to be silently expanded later.

## A1. `RouteClassification` reference table (own migration, minimal admin surface)

**`functions-restapi/sql/migration-016-route-classification.sql`** (new):
```sql
CREATE TABLE RouteClassification (
    route_id             INT           NOT NULL PRIMARY KEY,
    avail_route_name     NVARCHAR(100) NULL,      -- as named in Avail (e.g. "Special1111", "Rescue Bus") - used to pre-fill/suggest route_category below
    route_category       NVARCHAR(20)  NOT NULL, -- 'FixedRoute' | 'SpecialEvent' | 'OnDemand'
    route_label          NVARCHAR(100) NULL,      -- friendly name, e.g. "Vikings Game Shuttle"
    effective_start_date CHAR(8)       NULL,       -- YYYYMMDD, for reused event RouteIDs
    effective_end_date   CHAR(8)       NULL,
    is_active            BIT           NOT NULL DEFAULT 1,
    updated_by           NVARCHAR(200) NULL,
    updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_RouteClassification_Category CHECK (route_category IN ('FixedRoute', 'SpecialEvent', 'OnDemand'))
);
```
- **`functions-restapi/src/functions/routeClassification.ts`** (new): `GET /route-classification` (`STAFF_READ_ROLES` + `OCC.Compliance`) and `PUT /route-classification/{routeId}` (`PUBLISH_ROLES` - upsert one row, stamps `updated_by` from `authResult.principal.userDetails`, same convention as `adminExpirationDefaults.ts`). No bulk-import UI in this pass - the brief itself frames this as a light, occasional admin step ("someone adds/updates the row before the event runs"), not a high-volume workflow.
- **Frontend**: a small new section in the existing **`Admin.tsx`** page (mirrors its existing expiration-defaults editor exactly - a table with inline route_id/category/label fields + a save button), not a new module. `shared/types.ts`/`api.ts` get `RouteClassificationRow` + `getRouteClassification()`/`putRouteClassification()`. The editor pre-fills a suggested `route_category` of `SpecialEvent` when `avail_route_name` matches MVTA's existing Avail naming convention (`Special*` prefix, or exact matches like `Rescue Bus`/`Pivot`/`Reserved Pivot`/`Maintenance`/`Training`) - a suggestion the admin confirms or overrides, not an auto-classify. Reduces the "someone adds a row before the event runs" step to a review, not a blank-form fill-in.
- Every classification query defaults an unmatched `RouteID` to "unclassified" rather than silently assuming fixed-route (per the brief's own safety-net framing) - handled as `LEFT JOIN RouteClassification` + `COALESCE(route_category, 'Unclassified')` in the consuming queries below, not a separate staging table for this first pass (simpler; revisit a dedicated `UnclassifiedRoutes` table only if unclassified volume turns out to be a real problem).

## A2. Event-bus filtering runs on a new poller, interval configurable from the Admin UI (not the shared 5-minute AVL poll)

**[REVISED]** The original A2 reused the existing 5-minute `availAvlPoll.ts` cadence for event-bus positions. That's too coarse for A4's geofence crossing detection - a bus can cross a boundary and be well past it before the next 5-minute poll even runs, making a direction/heading-based crossing call wrong or missed entirely. Confirmed the Avail AVL feed itself refreshes at least every 15-30 seconds, so a faster poll is meaningful rather than just re-asking a stale answer more often.

**New, separate poller**: `eventAvlPoll.ts` (new Azure Function, own timer trigger, not an edit to `availAvlPoll.ts`, which stays at 5 min for the general fixed-route AVL feed other parts of the system depend on staying at that cadence). It hits the same Avail AVL endpoint independently, joins each mapped report's `route` against `RouteClassification`, and for `route_category = 'SpecialEvent'` matches only, upserts into `EventVehicleCurrentPosition` (latest-only) and inserts into `EventVehiclePositionHistory` (append-only). Fixed-route/unclassified pings are discarded at this stage, same as before, but remain fully available in `AvailAvlVehiclePositions` via the unchanged 5-min poller.

**Interval is UI-configurable, not hardcoded - via a shared parameters table, not an event-only one.** An Azure Functions timer trigger's own CRON schedule can't be changed live from a UI without a redeploy, so the pattern here is: the timer itself fires on a fixed **floor** cadence of every 15 seconds (the fastest useful value, matching Avail's confirmed refresh floor - also a guardrail so nobody can configure something faster and hammer the feed), and each invocation checks a stored setting before doing real work - if the configured interval hasn't elapsed since the last actual run, it's a no-op. Rather than a one-off `EventModuleSettings` table scoped only to this module, this is a good candidate for a generic, reusable settings table - other modules will likely want the same kind of admin-adjustable tunable later (a detour notification retry window, an OTP staleness threshold), and building it narrowly now just means re-inventing it per module. **[FLAG for Claude Code]**: check the live repo first for an existing generic settings/config table before adding this - if one already exists, add the event poll-interval row to it instead of creating a new one.

```sql
CREATE TABLE AppSettings (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    module        NVARCHAR(50)  NOT NULL,   -- e.g. 'event', 'otp', 'detour', 'global'
    setting_key   NVARCHAR(100) NOT NULL,
    setting_value NVARCHAR(500) NOT NULL,
    value_type    NVARCHAR(20)  NOT NULL DEFAULT 'int',  -- 'int' | 'string' | 'bool' | 'decimal'
    min_value     NVARCHAR(50)  NULL,
    max_value     NVARCHAR(50)  NULL,
    description   NVARCHAR(300) NULL,
    updated_by    NVARCHAR(200) NULL,
    updated_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AppSettings_ModuleKey UNIQUE (module, setting_key)
);
-- this pass's one row:
-- module='event', setting_key='poll_interval_seconds', setting_value='20',
-- value_type='int', min_value='15', max_value='300'
```

This module still only needs the one `event`-scoped row (`poll_interval_seconds`) and a `last_run_at` cursor - the cursor can live alongside the poller's own state (e.g. on `EventVehicleCurrentPosition`'s `updated_at` via a `MAX()` check, or a small dedicated cursor row) rather than on the settings table itself, so `AppSettings` stays a clean generic key-value store and doesn't accumulate module-specific columns like `last_run_at` that wouldn't make sense for a string or bool setting.

Since this table is meant for reuse well beyond the event module, it belongs in its own standalone migration - not bundled into `migration-016-route-classification.sql` - so it isn't tied to this module's numbering or scope.

Running the poller against the same Avail feed as `availAvlPoll.ts` increases event-window API call volume against Avail during an active event (more so at the 15s floor than at a staff-relaxed higher interval) - acceptable given Avail confirmed sub-30s freshness and this only runs while an event is actually being monitored, but worth Claude Code double-checking against any Avail rate-limit terms before shipping, and worth surfacing the current effective interval plainly in the Admin.tsx control so staff aren't guessing at the tradeoff.

**`functions-restapi/sql/migration-016-route-classification.sql`** also adds:
```sql
CREATE TABLE EventVehicleCurrentPosition (
    vehicle_id       INT       NOT NULL PRIMARY KEY,
    route            INT       NULL,
    latitude         FLOAT     NOT NULL,
    longitude        FLOAT     NOT NULL,
    heading          FLOAT     NULL,
    report_timestamp DATETIME2 NOT NULL,
    updated_at       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE EventVehiclePositionHistory (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    vehicle_id       INT       NOT NULL,
    route            INT       NULL,
    latitude         FLOAT     NOT NULL,
    longitude        FLOAT     NOT NULL,
    heading          FLOAT     NULL,
    report_timestamp DATETIME2 NOT NULL
);
CREATE INDEX IX_EventVehiclePositionHistory_Vehicle ON EventVehiclePositionHistory (vehicle_id, report_timestamp);
```
- **`functions-restapi/src/functions/eventVehiclePositions.ts`** (new): `GET /event-vehicle-positions` - current positions + diagnostics (mirrors `availAvl.ts` endpoint's shape exactly).
- **`functions-restapi/src/functions/eventAvlPoll.ts`** (new): the 15s-floor timer-triggered poller itself, structurally mirroring `availAvlPoll.ts`'s upsert pattern, but on its own schedule, gated by the `AppSettings` row for `module='event', setting_key='poll_interval_seconds'` plus its own run cursor, and writing only to the `Event*` tables above.
- **`functions-restapi/src/functions/appSettings.ts`** (new): `GET/PATCH /app-settings?module=event` (`ADMIN_ROLES`) - generic key-value read/update across any module, with `min_value`/`max_value` bounds enforced server-side (not just in the UI control). Designed to be extended by other modules later without new endpoints.

## A3. Frontend: real map, mock scenario retired

Per the redrafted user story (A0), the mock `POOL`-based scenario (MV-118/142/207/233, Lot A/Lot C schematic diagram, the delay-alert card with Approve-and-publish/Dismiss) is **retired**, not kept alongside the real panel - it modeled a Phase 2+ alerts/publishing workflow (Claude delay inference, staff review-and-approve) that's explicitly out of scope for this pass. Keeping it running next to real data would just misrepresent what the module actually does today.

In its place, **`EventMonitoring.tsx`**'s live panel - "Event bus positions" - renders `GET /event-vehicle-positions` on an **Azure Maps** map (Web SDK, `azure-maps-control` npm package) centered on the Twin Cities metro area, instead of the static Lot A/Fairgrounds schematic. Each vehicle plots as a marker (vehicle ID, route, last-report time on hover/click); a companion list view alongside the map mirrors this file's existing table-next-to-visual convention (same as the AVL Reports table pattern elsewhere in this file). Only `SpecialEvent`-classified vehicles appear, per A2's filtering - fixed-route and unclassified vehicles are not plotted here (they remain visible in the separate all-vehicles AVL table, unchanged).

- **New infra**: an Azure Maps account (Bicep module `infra-phase1/modules/maps.bicep`, provisioned-not-deployed-until-approved, same convention as every infra addition in this project), with the REST API Function App's managed identity granted the **Azure Maps Data Reader** role. A new endpoint, `GET /maps/token` (`STAFF_READ_ROLES`), issues a short-lived Azure AD token server-side for the frontend SDK to use - no standing Maps key ever shipped to the browser, consistent with this project's zero-standing-secret convention.
- Until real `RouteClassification` rows exist for an actual event, the map correctly renders with zero markers (same graceful empty state as today, just on a real basemap instead of a placeholder message) - expected, not a bug.

## A4. Geofencing (admin-managed, direction-aware alerts)

**Before writing any of this, Claude Code should check the repo for existing geofencing-related code/tables.** Ty has done related exploratory work using Codex that may partially overlap this - reconcile against whatever's already there rather than building a parallel/duplicate implementation. **Note: the Teams-alerting/notification-sending piece does not exist yet** (corrected from an earlier assumption in this doc) - it's designed fresh below, not integrated against something already built.

**Approach chosen: plain point-in-polygon math, not Azure Maps' managed Spatial Geofencing service.** The deciding factor is that the direction-to-destination inference below (e.g., "exiting southbound = likely headed to a transit station") isn't something the managed service does either way - that logic has to be custom regardless of backend, which removes most of the managed service's advantage. This approach also avoids a second paid Azure Maps API tier/surface beyond the free-tier map rendering already planned in A3, and runs on the same configurable-interval `eventAvlPoll.ts` poller from A2 rather than adding a further separate polling path.

**Not limited to lot boundaries**: `EventGeofences` is a generic table with no assumption baked in that a geofence sits only at an endpoint (a park-and-ride lot, the fairgrounds). Staff can draw as many geofences as useful along the actual travel corridor - a checkpoint partway along the route, a highway on/off-ramp, an intersection - each with its own direction rules. More geofences along the path means more granular movement alerting (not just "left the lot" / "arrived at the fairgrounds," but tracking progress along the way) - this is a deliberate design point, not an incidental side effect of the schema being generic.

**Drawing UX is a first-class requirement, not an afterthought**: geofence placement needs to feel as easy as drawing a shape in Google/Bing Maps - click to place vertices, drag to reshape after drawing, double-click (or click-the-first-point) to close the polygon, a visible delete/redraw affordance, no keyboard shortcuts or hidden gestures required. The Azure Maps Web SDK's `atlas.control.DrawingToolbar` (visible draw/edit/delete buttons) paired with `atlas.drawing.DrawingManager`'s interaction modes (draw-polygon, edit-geometry, idle) covers this out of the box - use it directly rather than hand-rolling a custom drawing interaction. This matters enough to call out explicitly: if the SDK's default toolbar ends up feeling clunky once a real admin tries it, that's worth raising as feedback before shipping, not something to silently work around.

**Admin-managed geofences** (`Admin.tsx`, alongside `RouteClassification`):
```sql
CREATE TABLE EventGeofences (
    id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name         NVARCHAR(100) NOT NULL,   -- e.g. "Lot A", "Fairgrounds Drop-off"
    polygon      NVARCHAR(MAX) NOT NULL,   -- GeoJSON Polygon, drawn via the Azure Maps SDK's drawing tools (same map/SDK as A3)
    is_active    BIT           NOT NULL DEFAULT 1,
    updated_by   NVARCHAR(200) NULL,
    updated_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE EventGeofenceDirectionRules (
    id                UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    geofence_id       UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    transition        NVARCHAR(10)  NOT NULL,  -- 'enter' | 'exit'
    heading_min       FLOAT         NOT NULL,  -- degrees, 0-360
    heading_max       FLOAT         NOT NULL,  -- may wrap past 360 (e.g. 350 -> 10 for a "north" range) - matching logic must handle wraparound, not a naive min/max compare
    destination_label NVARCHAR(200) NOT NULL,  -- e.g. "Likely en route to Cedar Grove Transit Station"
    sort_order        INT           NOT NULL DEFAULT 0,
    CONSTRAINT CK_EventGeofenceDirectionRules_Transition CHECK (transition IN ('enter', 'exit'))
);
```
A geofence can carry multiple direction rules (e.g., a southbound exit from Lot A means something different than a northbound exit from the same lot) - the admin draws the shape once, then attaches one or more heading-range-to-label rules to it. A crossing that matches no rule for its transition type still surfaces as a plain "entered/exited {name}" event with no destination inference.

**Poller integration**: after each AVL poll cycle updates `EventVehicleCurrentPosition` (A2), a new step runs a point-in-polygon check (`@turf/boolean-point-in-polygon`, or an equivalent small pure function if avoiding the new dependency is preferred - either is fine, this isn't complex geometry) for each `SpecialEvent` vehicle against all `is_active` geofences. A new table tracks last-known state per vehicle+geofence pair so a state flip (not just "currently inside") is what triggers an event:
```sql
CREATE TABLE EventGeofenceVehicleState (
    vehicle_id    INT              NOT NULL,
    geofence_id   UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    is_inside     BIT              NOT NULL,
    updated_at    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (vehicle_id, geofence_id)
);
CREATE TABLE EventGeofenceCrossings (
    id                 BIGINT IDENTITY(1,1) PRIMARY KEY,
    vehicle_id         INT              NOT NULL,
    geofence_id        UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    transition         NVARCHAR(10)     NOT NULL,  -- 'enter' | 'exit'
    heading_at_crossing FLOAT           NULL,
    destination_label  NVARCHAR(200)    NULL,       -- matched EventGeofenceDirectionRules.destination_label, or NULL if no rule matched
    crossed_at         DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_EventGeofenceCrossings_Vehicle ON EventGeofenceCrossings (vehicle_id, crossed_at);
```
On a state flip, the vehicle's `heading` (already captured in `EventVehicleCurrentPosition`, A2) is matched against that geofence's direction rules for the matching `transition`, and the result (label or none) is stamped onto the new `EventGeofenceCrossings` row.

**Admin-managed reference locations (`EventLocations`) - evergreen, not event-specific**

A destination label on a direction rule (below) is currently just free text - a human-readable guess with nothing structured behind it. A new `EventLocations` table gives it something real to point at, and doubles as a legend layer on the map itself (transit stations, venues, park-and-ride lots plotted with their own markers, distinct from vehicle markers) so staff get spatial context, not just bus dots on a blank basemap.

**Assumption made here, worth confirming**: `EventLocations` is designed evergreen - a transit station or venue is a location regardless of which event is using it this week, so there's no `event_id`/season scoping on this table. This is what makes the module reusable beyond the State Fair with zero new code (a concert venue or ballgame just means adding rows and drawing new geofences around them) - flag if a per-event scoping was actually intended instead.

```sql
CREATE TABLE EventLocations (
    id          UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name        NVARCHAR(150) NOT NULL,   -- e.g. "Cedar Grove Transit Station", "State Fairgrounds"
    category    NVARCHAR(20)  NOT NULL,   -- 'transit_station' | 'venue' | 'park_and_ride' | 'other'
    latitude    FLOAT         NOT NULL,
    longitude   FLOAT         NOT NULL,
    notes       NVARCHAR(500) NULL,
    is_active   BIT           NOT NULL DEFAULT 1,
    updated_by  NVARCHAR(200) NULL,
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventLocations_Category CHECK (category IN ('transit_station', 'venue', 'park_and_ride', 'other'))
);
```
`EventGeofenceDirectionRules.destination_label` (defined above) gains an optional `destination_location_id` reference to `EventLocations.id` - free text stays available as a fallback for quick/informal cases, but a rule can now point at a real, mapped place instead of only a guess string. That's what makes a crossing's inference more than a label in a Teams message - it's tied to actual coordinates, which opens the door to plotting "likely headed toward X" as a line on the map later, not just text.

- **`functions-restapi/src/functions/eventLocations.ts`** (new) - `GET/POST/PATCH /event-locations` (`ADMIN_ROLES` for write, `STAFF_READ_ROLES` for read), same conventions as `routeClassification.ts`/`eventGeofences.ts`.
- **Frontend**: `Admin.tsx` gets an `EventLocations` editor (name/category/lat-lon - either typed or click-to-place on the Azure Maps drawing surface from A3, whichever proves easier in practice); `EventMonitoring.tsx`'s map gets a legend/marker layer for active locations, one icon style per category, toggleable so the vehicle view isn't cluttered when it's not needed.



On a crossing, the poller (A2's integration point) enqueues a small message (crossing id) to a new Service Bus queue - `event-geofence-notifications`, added to the existing Service Bus namespace already in use elsewhere in this project (no new resource type, just a new queue). This decouples crossing detection from the Teams send: a slow or failed Teams post never blocks or delays the next AVL poll cycle.

A queue-triggered function, **`functions-restapi/src/functions/eventGeofenceNotify.ts`** (new), consumes each message, looks up the crossing + its matched direction rule, and auto-drafts a Teams message (closure/vehicle/geofence/destination-label, same auto-draft-from-existing-data approach as the Detour module's B9 notification design - reuse the pattern, don't reinvent it). What happens next depends on that rule's **send mode**:

- **Manual** (the default): the draft is written to a new `EventGeofenceNotifications` row with `status = 'pending'` and surfaces in `EventMonitoring.tsx`'s crossings feed as a reviewable card - draft text, an "Approve and Send" action and a "Dismiss" action, for an OCC/control-center specialist to act on. This deliberately reuses the review-before-send interaction pattern from the original mock's delay-alert card (retired in A3 for being backed by fake data) - the pattern was right, it just needed real data behind it, which this now provides. Only on explicit approval does the function actually POST to the Teams webhook and stamp `status = 'sent'`, `sent_by`, `sent_at`.
- **Auto**: the function POSTs to the Teams webhook immediately, no human step, and logs `status = 'sent'` with `sent_by = NULL` (system-sent) right away.

Send mode is set **per direction rule**, not globally - `EventGeofenceDirectionRules` gets a new `send_mode` column (`'manual' | 'auto'`, default `'manual'`). This lets an admin start every rule as manual-review (matching this project's standing "no unreviewed auto-publish" convention) and deliberately promote specific, well-trusted rules to auto-send once their accuracy is proven out in practice - a rule with a vague or frequently-wrong destination label stays manual; an unambiguous one (e.g., "exiting Lot A, any heading, always means departing") can graduate to auto. This is an explicit, opt-in exception to the project's default review-before-send convention, scoped narrowly to rules an admin has specifically flagged as trustworthy - not a blanket auto-send default.

```sql
-- added to EventGeofenceDirectionRules (A4 schema above):
ALTER TABLE EventGeofenceDirectionRules ADD send_mode NVARCHAR(10) NOT NULL DEFAULT 'manual';
ALTER TABLE EventGeofenceDirectionRules ADD CONSTRAINT CK_EventGeofenceDirectionRules_SendMode CHECK (send_mode IN ('manual', 'auto'));

CREATE TABLE EventGeofenceNotifications (
    id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    crossing_id   BIGINT           NOT NULL REFERENCES EventGeofenceCrossings(id),
    send_mode     NVARCHAR(10)     NOT NULL,  -- snapshot of the rule's mode at the time, in case the rule changes later
    message_body  NVARCHAR(1000)   NOT NULL,
    status        NVARCHAR(10)     NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'dismissed'
    sent_by       NVARCHAR(200)    NULL,   -- NULL for auto-sent
    sent_at       DATETIME2        NULL,
    created_at    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventGeofenceNotifications_Status CHECK (status IN ('pending', 'sent', 'dismissed'))
);
```

- **API**: `GET /event-geofence-notifications?status=pending` (`STAFF_READ_ROLES`, drives the crossings feed's reviewable cards), `POST /event-geofence-notifications/{id}/send` (`PUBLISH_ROLES` - manual approve-and-send), `POST /event-geofence-notifications/{id}/dismiss` (`PUBLISH_ROLES`).
- **Infra**: new queue on the existing Service Bus namespace (small addition to whatever Bicep module already defines it - Claude Code should locate that file rather than assume a name), plus a Teams Incoming Webhook URL stored as a Key Vault secret / app setting - **provisioning the webhook is an MVTA-side Teams-admin action, not something Claude Code can do from the repo**, same category of owner-gated action as every other new external integration in this project.
- **Frontend**: `Admin.tsx`'s direction-rule editor gets a `send_mode` toggle per rule; `EventMonitoring.tsx`'s crossings feed renders pending manual notifications as approve/dismiss cards and sent/dismissed ones as a plain history log.

- **`functions-restapi/src/functions/eventGeofences.ts`** (new) - `GET/POST/PATCH /event-geofences` (`ADMIN_ROLES` for write, `STAFF_READ_ROLES` for read) and the direction-rules sub-resource, mirroring `routeClassification.ts`'s conventions.
- **`functions-restapi/src/functions/eventGeofenceCrossings.ts`** (new) - `GET /event-geofence-crossings` for the console to show a recent-crossings feed.
- **Frontend**: `Admin.tsx` gets a geofence editor built on the Azure Maps drawing toolbar described above (draw, reshape, delete geofences directly on the map from A3; name each one; attach direction rules with a heading-range picker) - supports any number of geofences anywhere along the corridor, not just at the two endpoints; `EventMonitoring.tsx`'s live panel gets a crossings feed alongside the vehicle map/list.
- **Honest limitation to flag**: crossings are only detected as fast as the currently-configured poll interval (15s floor, staff-adjustable up to 5 min via the `AppSettings` row from A2) - a crossing could be surfaced up to that many seconds after it actually happened, and could be slower than expected if staff have relaxed the interval and forgotten. Good enough for near-real-time alerting; not instantaneous. Worth the Admin.tsx control showing the current effective interval plainly, not just letting it be set-and-forget.

## A5. Audit trail integration (applies across A1-A4)

Every event-producing piece of this plan - `RouteClassification` changes (A1), `EventGeofenceCrossings` (A4), and `EventGeofenceNotifications` sends/dismissals (A4) - should surface through the same audit-stream pattern already established by `otpAuditStream.ts` elsewhere in this project: a merge-by-timestamp read directly off each table's existing audit/timestamp columns (`updated_by`/`updated_at`, `crossed_at`, `sent_at`/`created_at`), not a new separate write-path or duplicate logging table. This project's standing convention is "the record is the audit trail," and this plan's tables were already designed with that in mind (A1's `updated_by`/`updated_at`, A4's `crossed_at`/`sent_by`/`sent_at`) - A5 just makes explicit that they need to actually be wired into a queryable historical view, not just sit as isolated columns nobody reads back.

Before building this, Claude Code should check whether `otpAuditStream.ts` is written generically enough to extend with additional event sources, or whether it's OTP-specific and this plan needs its own equivalent (e.g. `eventModuleAuditStream.ts`, same merge-by-timestamp approach, covering `RouteClassification`/`EventGeofenceCrossings`/`EventGeofenceNotifications` as its three sources). Either way, the result should be one place staff can see a chronological history across route-classification edits, geofence crossings, and notifications sent/dismissed for a given time window or event - not three separate places to check.

- **API**: `GET /event-module-audit-stream?from=&to=` (`STAFF_READ_ROLES` + `OCC.Compliance`, matching the read gating used elsewhere in this plan), returning the merged, timestamp-sorted events.
- **Frontend**: a history/audit view in `EventMonitoring.tsx` (or its own small panel) - not necessarily a new top-level page, given how small this module is expected to stay.

## A6. Service Plans (event-scoped activation layer over A1/A4)

`RouteClassification` (A1), `EventGeofences`/`EventGeofenceDirectionRules` (A4), and `EventLocations` (A4) are all designed evergreen/reusable - a "Lot A" geofence or a transit station shouldn't need to be redrawn or re-entered every time an event recurs. But that reusability creates a real risk: a route, geofence, or location left over from a past or future event could sit in the database indefinitely and accidentally surface in a live notification just because its own `is_active` flag happens to be set, with nobody having deliberately connected it to *this* event's actual operating window.

**Service Plans close that gap.** A plan is the explicit, staff-driven container that says "these specific routes/geofences/locations are genuinely in service right now" - nothing among A1/A4's evergreen tables is treated as truly live for poller filtering, crossing detection, or notification content unless it's linked to a Service Plan that's been advanced to `active`.

```sql
CREATE TABLE EventServicePlans (
    id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    name         NVARCHAR(150) NOT NULL,   -- e.g. "2026 State Fair Shuttle Service"
    status       NVARCHAR(10)  NOT NULL DEFAULT 'draft',  -- 'draft' | 'active' | 'completed'
    start_date   DATE          NULL,
    end_date     DATE          NULL,
    created_by   NVARCHAR(200) NOT NULL,
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by   NVARCHAR(200) NULL,
    updated_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_EventServicePlans_Status CHECK (status IN ('draft', 'active', 'completed'))
);
CREATE TABLE EventServicePlanRoutes (
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    route_id        INT              NOT NULL REFERENCES RouteClassification(route_id),
    PRIMARY KEY (service_plan_id, route_id)
);
CREATE TABLE EventServicePlanGeofences (
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    geofence_id     UNIQUEIDENTIFIER NOT NULL REFERENCES EventGeofences(id),
    PRIMARY KEY (service_plan_id, geofence_id)
);
CREATE TABLE EventServicePlanLocations (
    service_plan_id UNIQUEIDENTIFIER NOT NULL REFERENCES EventServicePlans(id),
    location_id     UNIQUEIDENTIFIER NOT NULL REFERENCES EventLocations(id),
    PRIMARY KEY (service_plan_id, location_id)
);
```

**Workflow**: an admin creates a plan in `draft`, links the routes/geofences/locations it needs (reusing existing evergreen rows where they already exist - see below - rather than re-entering them), then takes one explicit **"Advance to Active"** action when the event's operating window begins. Only that single action, not a date range alone, flips a plan live - avoids a plan silently going active on its `start_date` with nobody having actually confirmed it's ready. Marking a plan `completed` afterward doesn't delete or deactivate the underlying routes/geofences/locations themselves - they remain in the system, evergreen, ready to be linked into a future plan.

**The gate itself**: every consuming query gets one additional condition alongside its existing `is_active` check - `AND EXISTS (SELECT 1 FROM EventServicePlan{Routes|Geofences|Locations} sp JOIN EventServicePlans p ON p.id = sp.service_plan_id WHERE p.status = 'active' AND sp.<foreign key> = <row id>)`. This applies to: A2's poller (only classifies/writes event positions for routes linked to an active plan), A4's crossing detection (only active-plan geofences are checked against vehicle positions), and A4's notification drafting (only active-plan locations can be resolved as a `destination_location_id`). A route/geofence/location that exists and is individually `is_active = 1` but isn't linked to any currently-active plan is simply inert - it can't fire, filter, or appear in a message, by construction rather than by convention.

**Reuse at plan-creation time**: when linking routes/geofences/locations into a new plan, the Admin.tsx picker should surface existing evergreen rows as selectable candidates first (an existing "Lot A" geofence, an existing "Cedar Grove Transit Station" location) rather than defaulting to "create new" - the whole point of keeping A1/A4 evergreen is that a recurring event's plan should mostly be *assembling already-known pieces*, not re-authoring them each year.

- **`functions-restapi/src/functions/eventServicePlans.ts`** (new) - `GET/POST/PATCH /event-service-plans` (`ADMIN_ROLES`), plus link/unlink endpoints for routes/geofences/locations, and the `POST /event-service-plans/{id}/advance` action (separate from a generic PATCH, since activating is a deliberate, audited moment - not just another field edit).
- **Frontend**: a new Service Plans section in `Admin.tsx` - plan list (draft/active/completed), a plan detail view for linking existing routes/geofences/locations or creating new ones inline, and the explicit Advance action.
- A2/A4's functions above get the additional `EXISTS (...active plan link...)` condition added to their existing queries - flagged here as an addition to those already-specified queries, not a rewrite of their core logic.




## Explicitly out of scope for this pass

- The rest of Manual §18's full design (`StaffAssignments`, `Events`, `TrafficConditions`, `PredictedDelays`, checkpoint/headway watchlists, post-event reports) - this pass only closes the specific gap the new doc raises (route classification + live position for event buses, plus geofencing per A4 below), not the entire Special Event Vehicle Monitoring module. Note: Manual §18 listed "geofence watchlists" among the deferred items originally; **A4 below now brings a scoped version of that in**, superseding that specific exclusion - everything else in this bullet remains deferred.
- A dedicated `UnclassifiedRoutes` staging table - deferred unless unclassified volume proves to be a real problem.
- Resolving the AVL Reports URL-shape discrepancy definitively - flagged, not guessed past; the existing single-date shape stays since it's the one confirmed against a real owner-provided endpoint.

---

## Files to touch/add
`functions-restapi/sql/migration-016-route-classification.sql` (new), `functions-restapi/sql/migration-0XX-app-settings.sql` (new - standalone, generic table not tied to this module's numbering, confirm current head first), `src/functions/routeClassification.ts` (new), `src/functions/eventVehiclePositions.ts` (new), `src/functions/eventAvlPoll.ts` (new - 15s-floor poller, effective interval UI-configurable, `availAvlPoll.ts` itself is untouched), `src/functions/appSettings.ts` (new - generic key-value read/update, this pass only populates the `event` module's poll-interval row), `src/functions/mapsToken.ts` (new), `infra-phase1/modules/maps.bicep` (new), `infra-phase1/main-phase1.bicep` (wire the new module), `frontend/packages/onboard-console/src/routes/Admin.tsx` (extend - includes poll interval control, ideally under a generic Settings section reusable by other modules later), `frontend/packages/onboard-console/src/routes/modules/EventMonitoring.tsx` (rewrite live panel - real map, mock scenario removed), `frontend/packages/onboard-console/package.json` (new dependency: `azure-maps-control`), `frontend/packages/shared/src/types.ts`/`api.ts`, `CHANGELOG.md`, `HANDOFF.md`

**A4 (geofencing + reference locations + notification pipeline)**: `functions-restapi/sql/migration-0XX-event-geofences.sql` (new - exact number assigned at build time, confirm current head first), `src/functions/eventGeofences.ts` (new), `src/functions/eventGeofenceCrossings.ts` (new), `src/functions/eventLocations.ts` (new), `src/functions/eventGeofenceNotify.ts` (new - queue-triggered), `src/functions/eventGeofenceNotifications.ts` (new - send/dismiss endpoints), `src/functions/eventAvlPoll.ts` (extend further - crossing detection + queue enqueue, added on top of A2's own additions to this same new file), `infra-phase1/modules/servicebus.bicep` or equivalent (extend - new queue), `frontend/packages/onboard-console/package.json` (new dependency: `@turf/boolean-point-in-polygon`, if used), `Admin.tsx` (extend - geofence editor + send_mode toggle + EventLocations editor), `EventMonitoring.tsx` (extend - crossings feed with approve/dismiss cards + location legend/marker layer)

**A5 (audit trail)**: `functions-restapi/src/functions/otpAuditStream.ts` (check first - extend if generic enough) or `src/functions/eventModuleAuditStream.ts` (new, if not), `EventMonitoring.tsx` (extend further - history/audit view)

**A6 (Service Plans)**: `functions-restapi/sql/migration-0XX-event-service-plans.sql` (new), `src/functions/eventServicePlans.ts` (new), `src/functions/eventAvlPoll.ts`/`eventGeofences.ts`/`eventGeofenceCrossings.ts`/`eventGeofenceNotify.ts` (extend - active-plan gating condition added to existing queries), `Admin.tsx` (extend - Service Plans section)

---

## Recommended build sequence
1. **A1** (`RouteClassification` table + Admin.tsx section) - cheap, unblocks A2, useful on its own for future Avail feed work even before A2/A3 land.
2. **A2** (event-bus filtering in the existing AVL poller) - small once A1 exists.
3. **A3** (`EventMonitoring.tsx`'s Azure Maps panel) - needs the Azure Maps Bicep module approved and deployed first; natural pause point for sign-off before provisioning.
4. **A4** (geofencing + reference locations + notification pipeline) - builds on A2's position data and A3's map/drawing tools. The Teams webhook provisioning (an MVTA-side Teams-admin action) is a natural pause point before the notification-sending half goes live, same pattern as every other new external integration in this project.
5. **A6** (Service Plans) - after A1 and A4 exist (it links their rows), but its gating condition should be added to A2's and A4's queries as part of this step, before A5's audit stream is built on top of the final shape of those tables.
6. **A5** (audit trail integration) - last, since it reads off A1/A4/A6's tables once their final query shape (including A6's gating) is settled.

## Verification (per part, as each is implemented)
- `npm run build && npm test` in `functions-restapi`.
- `npm run build` in `frontend`.
- Browser pass: RouteClassification editor in Admin.tsx (including the naming-convention pre-fill); EventMonitoring's event-bus panel showing its correct empty state before any classification rows exist, then correct filtering + map rendering once a mocked `SpecialEvent` row is added; the Admin.tsx poll interval control correctly rejecting a value outside 15-300s both client-side and server-side, and a changed value taking effect on the next `eventAvlPoll.ts` invocation without a redeploy; a geofence drawn in Admin.tsx correctly firing an enter/exit event with the right destination label once a mocked vehicle position crosses it, including a heading range that wraps past 360°; an `EventLocations` entry showing correctly on the map's legend/marker layer and selectable as a direction rule's `destination_location_id`; a `manual`-mode rule producing a reviewable pending card that only sends on explicit approval, and an `auto`-mode rule sending immediately with no card - both correctly logged in `EventGeofenceNotifications`; a route/geofence/location linked only to a `draft` Service Plan correctly staying inert (no poller filtering, no crossing detection, not selectable as a notification destination) until the plan is explicitly advanced to `active`.
- **Owner actions (blocking, live environment, sequenced per the build order above):**
  1. Run migration-016 against the dev DB.
  2. Approve and deploy the new Azure Maps Bicep module before A3's map goes live (new resource; expected to stay within the S0 free-tier transaction allotment at this module's usage volume, but flagging as a real resource before provisioning, same convention as every other infra addition here).
  3. Deploy code per part.
