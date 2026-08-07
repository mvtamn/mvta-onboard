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

## A2. Event-bus filtering reuses the existing 5-minute AVL poll (not a new high-frequency fetch)

Rather than building the doc's proposed separate short-interval (1-2 min) rolling-window fetch - which (a) would double Avail API calls against the same feed, (b) depends on an AVL Reports URL shape that conflicts with what's already confirmed working, and (c) the doc's own open question #5 admits the right polling interval isn't actually known yet - **`availAvlPoll.ts` gets one small addition**: after its existing upsert into `AvailAvlVehiclePositions`, it also joins each mapped report's `route` against `RouteClassification` and, for `route_category = 'SpecialEvent'` matches only, upserts into a new `EventVehicleCurrentPosition` (latest-only, same shape as the AVL poller's existing style) and inserts into `EventVehiclePositionHistory` (append-only). Fixed-route/unclassified pings are simply not written to either event table (discarded at this stage, per the doc's own design) but remain fully available in `AvailAvlVehiclePositions` as today. If 5-minute cadence turns out to be too slow once a real event is monitored, revisit the cadence then - cheap to change later, not worth guessing now.

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

## A3. Frontend: real map, mock scenario retired

Per the redrafted user story (A0), the mock `POOL`-based scenario (MV-118/142/207/233, Lot A/Lot C schematic diagram, the delay-alert card with Approve-and-publish/Dismiss) is **retired**, not kept alongside the real panel - it modeled a Phase 2+ alerts/publishing workflow (Claude delay inference, staff review-and-approve) that's explicitly out of scope for this pass. Keeping it running next to real data would just misrepresent what the module actually does today.

In its place, **`EventMonitoring.tsx`**'s live panel - "Event bus positions" - renders `GET /event-vehicle-positions` on an **Azure Maps** map (Web SDK, `azure-maps-control` npm package) centered on the Twin Cities metro area, instead of the static Lot A/Fairgrounds schematic. Each vehicle plots as a marker (vehicle ID, route, last-report time on hover/click); a companion list view alongside the map mirrors this file's existing table-next-to-visual convention (same as the AVL Reports table pattern elsewhere in this file). Only `SpecialEvent`-classified vehicles appear, per A2's filtering - fixed-route and unclassified vehicles are not plotted here (they remain visible in the separate all-vehicles AVL table, unchanged).

- **New infra**: an Azure Maps account (Bicep module `infra-phase1/modules/maps.bicep`, provisioned-not-deployed-until-approved, same convention as every infra addition in this project), with the REST API Function App's managed identity granted the **Azure Maps Data Reader** role. A new endpoint, `GET /maps/token` (`STAFF_READ_ROLES`), issues a short-lived Azure AD token server-side for the frontend SDK to use - no standing Maps key ever shipped to the browser, consistent with this project's zero-standing-secret convention.
- Until real `RouteClassification` rows exist for an actual event, the map correctly renders with zero markers (same graceful empty state as today, just on a real basemap instead of a placeholder message) - expected, not a bug.

## Explicitly out of scope for this pass
- The rest of Manual §18's full design (`StaffAssignments`, `Events`, `TrafficConditions`, `PredictedDelays`, checkpoint/headway/geofence watchlists, post-event reports) - this pass only closes the specific gap the new doc raises (route classification + live position for event buses), not the entire Special Event Vehicle Monitoring module.
- A dedicated `UnclassifiedRoutes` staging table - deferred unless unclassified volume proves to be a real problem.
- Resolving the AVL Reports URL-shape discrepancy definitively - flagged, not guessed past; the existing single-date shape stays since it's the one confirmed against a real owner-provided endpoint.

---

## Files to touch/add
`functions-restapi/sql/migration-016-route-classification.sql` (new), `src/functions/routeClassification.ts` (new), `src/functions/eventVehiclePositions.ts` (new), `src/functions/mapsToken.ts` (new), `src/functions/availAvlPoll.ts` (extend), `infra-phase1/modules/maps.bicep` (new), `infra-phase1/main-phase1.bicep` (wire the new module), `frontend/packages/onboard-console/src/routes/Admin.tsx` (extend), `frontend/packages/onboard-console/src/routes/modules/EventMonitoring.tsx` (rewrite live panel - real map, mock scenario removed), `frontend/packages/onboard-console/package.json` (new dependency: `azure-maps-control`), `frontend/packages/shared/src/types.ts`/`api.ts`, `CHANGELOG.md`, `HANDOFF.md`

---

## Recommended build sequence
1. **A1** (`RouteClassification` table + Admin.tsx section) - cheap, unblocks A2, useful on its own for future Avail feed work even before A2/A3 land.
2. **A2** (event-bus filtering in the existing AVL poller) - small once A1 exists.
3. **A3** (`EventMonitoring.tsx`'s Azure Maps panel) - needs the Azure Maps Bicep module approved and deployed first; natural pause point for sign-off before provisioning.

## Verification (per part, as each is implemented)
- `npm run build && npm test` in `functions-restapi`.
- `npm run build` in `frontend`.
- Browser pass: RouteClassification editor in Admin.tsx (including the naming-convention pre-fill); EventMonitoring's event-bus panel showing its correct empty state before any classification rows exist, then correct filtering + map rendering once a mocked `SpecialEvent` row is added.
- **Owner actions (blocking, live environment, sequenced per the build order above):**
  1. Run migration-016 against the dev DB.
  2. Approve and deploy the new Azure Maps Bicep module before A3's map goes live (new resource; expected to stay within the S0 free-tier transaction allotment at this module's usage volume, but flagging as a real resource before provisioning, same convention as every other infra addition here).
  3. Deploy code per part.
