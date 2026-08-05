# Implementation Plan — Route Classification + Event Bus Monitoring, and a new Detour & Closure module

## Context

Two documents at the repo root drive this plan:

- **`OTP-Feed-Evaluation-and-Recommendation (2).md`** — a superset of the doc already implemented (see `CHANGELOG.md`'s OTP Compliance entry). Its OTP Monthly / Missed Trips feed content is unchanged from the original - that work stands as-is, no rework needed. It adds three new sections: confirmed `{Property}=MVTA` (already used everywhere), a **route classification problem** (`RouteID` in every Avail feed is a bare number with no fixed-route-vs-special-event flag), and a **new use for AVL Reports**: real-time tracking of *special event* buses specifically for the still-unbuilt Event Module (`MVTA_ONBOARD_MANUAL.md` §18, `Special_Event_Vehicle_Monitoring_Module_1.docx` - "fully specified, still unbuilt").
- **`detour-module-build-brief.md`** — a full spec for a new Detour & Closure module: MVTA tracks detours/closures by hand across Avail (when buildable there), staff email, and an Excel tracker today. Confirmed via repo research: **entirely greenfield** - `detour` exists today only as one message *category* value (`Messages.category`), not a data model of its own.

**Owner decisions confirmed for this pass:**
- Detour image uploads: same access tier as detour edit (no separate permission).
- Image retention: purge on detour expiry (safe default, revisit later if needed).
- Images resized/compressed client-side before upload.
- Detours module: new top-level nav tab (not nested under Compliance/OCC Tools) - visible read-only to `OCC.Viewer`, full access to `OCC.Publisher`/`OCC.Admin` (same tier as posting rider messages).

**Research findings that shape the approach:**
- No Blob Storage account/container exists anywhere in `infra-phase1/*.bicep` today (only `AzureWebJobsStorage`, embedded in `functionapp.bicep`) - a new Bicep module is needed, and no Function anywhere uses `@azure/storage-blob` yet (not an existing dependency).
- No "User Admin" role exists in this codebase (`auth.ts`'s `STAFF_READ_ROLES`/`PUBLISH_ROLES`/`ADMIN_ROLES`, or the frontend's `AppRole` union) - it's the brief author's own terminology, not existing plumbing. Reuse the existing 4 roles (`OCC.Viewer`/`OCC.Publisher`/`OCC.Admin`/`System.Ingestion`) plus `OCC.Compliance` - no new role needed for this workstream.
- `availAvlPoll.ts` already fetches **every** vehicle from AVL Reports every 5 minutes and upserts into `AvailAvlVehiclePositions` (`vehicle_id`-keyed, no route filtering at all) - confirmed via full file read. This matters for Part A below.
- `GtfsRoutes.route_type` (migration-010) is the **standard GTFS mode enum** (all 20 seeded MVTA routes are `3` = bus) - not a fixed-route/event distinction. No existing table classifies routes by fixed-route-vs-event.
- The new doc's AVL Reports URL shape (`GET /{Property}/{Start DateTime}/{End DateTime}`) doesn't match the already-built `availAvl.ts`'s single-date URL (`GET /{Property}/{date}`, confirmed against the owner's own real endpoint earlier this project). **This is a genuine, unresolved discrepancy between the two docs' spec sheets** - not something to guess past. Addressed below by not building a second, separately-shaped AVL fetch at all (see Part A).
- Highest existing migration is `migration-015-avail-missed-trips.sql`; next is `016`.
- `db.ts`'s `getPool()`/`sql` export pattern, `Compliance.tsx`/`OccTools.tsx`'s `TOOLS` array + switcher pattern, and `App.tsx`'s `PAGE_META`/`NavLink`/`RequireRole` pattern for a brand-new top-level route are all confirmed and reused directly below.

---

## Part A — Route Classification + Event Bus Monitoring

### A1. `RouteClassification` reference table (own migration, minimal admin surface)

**`functions-restapi/sql/migration-016-route-classification.sql`** (new):
```sql
CREATE TABLE RouteClassification (
    route_id             INT           NOT NULL PRIMARY KEY,
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
- **Frontend**: a small new section in the existing **`Admin.tsx`** page (mirrors its existing expiration-defaults editor exactly - a table with inline route_id/category/label fields + a save button), not a new module. `shared/types.ts`/`api.ts` get `RouteClassificationRow` + `getRouteClassification()`/`putRouteClassification()`.
- Every classification query defaults an unmatched `RouteID` to "unclassified" rather than silently assuming fixed-route (per the brief's own safety-net framing) - handled as `LEFT JOIN RouteClassification` + `COALESCE(route_category, 'Unclassified')` in the consuming queries below, not a separate staging table for this first pass (simpler; revisit a dedicated `UnclassifiedRoutes` table only if unclassified volume turns out to be a real problem).

### A2. Event-bus filtering reuses the existing 5-minute AVL poll (not a new high-frequency fetch)

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

### A3. Frontend: additive, not a replacement of the mock scenario

**`EventMonitoring.tsx`** gets a third panel - "Event bus positions (live)" - sourced from `GET /event-vehicle-positions`, added alongside (not replacing) both the existing mock event-shuttle scenario and the existing all-vehicles AVL table, matching this file's own established convention. Until real `RouteClassification` rows exist for an actual event, this panel will correctly show zero vehicles (graceful "no event vehicles classified yet" state) - expected, not a bug. Retiring the mock `POOL`-based scenario is explicitly **not** part of this pass; it stays until real event data has been exercised at least once during a live event.

### Explicitly out of scope for Part A
- The rest of Manual §18's full design (`StaffAssignments`, `Events`, `TrafficConditions`, `PredictedDelays`, checkpoint/headway/geofence watchlists, post-event reports) - this pass only closes the specific gap the new doc raises (route classification + live position for event buses), not the entire Special Event Vehicle Monitoring module.
- A dedicated `UnclassifiedRoutes` staging table - deferred unless unclassified volume proves to be a real problem.
- Resolving the AVL Reports URL-shape discrepancy definitively - flagged, not guessed past; the existing single-date shape stays since it's the one confirmed against a real owner-provided endpoint.

---

## Part B — Detour & Closure module

### B1. Schema (`Source`/`ExternalDetourId` from day one, per the brief's own advice)

**`functions-restapi/sql/migration-017-detours.sql`** (new):
```sql
CREATE TABLE Detours (
    id                    UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    number                NVARCHAR(50)  NULL,       -- free text: "951", "Operator Message", "993 & 994"
    closure               NVARCHAR(500) NOT NULL,   -- location/description
    start_date            DATE          NULL,
    end_date              DATE          NULL,        -- nullable - many are open-ended
    is_monitor_only       BIT          NOT NULL DEFAULT 0,
    riders_directed       NVARCHAR(500) NULL,
    email_sent            BIT          NOT NULL DEFAULT 0,
    expired_email_sent    BIT         NOT NULL DEFAULT 0,
    spare_emailed         BIT         NOT NULL DEFAULT 0,
    source                NVARCHAR(10) NOT NULL DEFAULT 'manual', -- 'manual' | 'avail'
    external_detour_id    NVARCHAR(50) NULL,
    last_edited_manually  BIT        NOT NULL DEFAULT 0, -- true once a human touches an 'avail'-sourced row
    is_deleted            BIT        NOT NULL DEFAULT 0,
    created_by            NVARCHAR(200) NOT NULL,
    created_at            DATETIME2  NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by            NVARCHAR(200) NULL,
    updated_at            DATETIME2  NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Detours_Source CHECK (source IN ('manual', 'avail'))
);
CREATE UNIQUE INDEX UX_Detours_ExternalDetourId ON Detours (external_detour_id) WHERE external_detour_id IS NOT NULL;

CREATE TABLE DetourSegments (
    id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    detour_id    UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
    routes       NVARCHAR(200) NOT NULL,   -- e.g. "460 SB, 465 SB"
    directions   NVARCHAR(MAX) NULL,        -- turn-by-turn text
    sort_order   INT NOT NULL DEFAULT 0
);
CREATE INDEX IX_DetourSegments_DetourId ON DetourSegments (detour_id);
```
- **Status (Active/Upcoming/Monitor/Recently finished/Expired) is computed, never stored** - one shared pure function: `functions-restapi/src/lib/detourStatus.ts` (`computeDetourStatus(d): DetourStatus`, used by the list endpoint's filtering). A client-side copy is added to `frontend/packages/shared/src/` only if a real need for computing it without a refetch shows up - start server-side only in this pass.

### B2. Manual-entry CRUD API + console module

Mirrors `messagesCreate.ts`/`fixedRouteDepartures.ts`'s conventions exactly (`requireRole`, `validation.ts`-style body validators, guard-clause mappers):
- `POST /detours` (`PUBLISH_ROLES`) - create, `source` always forced to `'manual'` server-side (never trusted from the body, same trust-boundary fix already applied to `created_by` elsewhere in this codebase).
- `GET /detours?status=` (`STAFF_READ_ROLES` - includes `OCC.Viewer`, per the owner's read-only decision) - list with computed status filter, joins `DetourSegments`.
- `PATCH /detours/{id}` (`PUBLISH_ROLES`) - edit; if the row's `source = 'avail'`, sets `last_edited_manually = 1` (feeds B5).
- `DELETE /detours/{id}` (`PUBLISH_ROLES`) - soft delete (`is_deleted = 1`), never a hard delete, matching this repo's existing retract-not-delete convention (`messagesRetract.ts`).
- **`frontend/packages/onboard-console/src/routes/Detours.tsx`** (new top-level route, not nested) - status tabs (Active/Upcoming/Monitor/Recently finished/Expired) computed client-side via the same status logic, an entry form (Number/Closure/dates/Monitor-only checkbox/Riders Directed/the three tracker flags + per-segment Routes/Directions rows), and a detail/expand panel per the prototype. Reuses `.panel-header`/`.panel-body`/`.subcard`/`table.data`/`pill-sm`/`btn-sm` throughout - no new global CSS expected beyond one status-tab strip (reuse `.occ-switch` if it fits visually).
- **`App.tsx`**: new `const DETOUR_ROLES = ["OCC.Viewer", "OCC.Publisher", "OCC.Admin", "OCC.Compliance"] as const;` (view+edit both gated here; the component itself hides edit controls for Viewer-only, mirroring how Compose already restricts write actions client-side while the server enforces the real boundary), new sidebar `NavLink`, new `PAGE_META` entry, new `<Route path="/detours" element={<RequireRole allowed={[...DETOUR_ROLES]}><Detours /></RequireRole>} />`.

### B3. Image attachments (Blob Storage - new infra)

- **`infra-phase1/modules/storage-detour-images.bicep`** (new) - a small, focused module (private container, no public-read, matching every other module's flat-file/param/output convention observed in `functionapp.bicep`/`servicebus.bicep`) provisioning one Storage account + one private blob container (`detour-images`), with a role assignment granting the REST API Function App's managed identity **Storage Blob Data Contributor** on it (same `existing roleDefinitions` + `roleAssignments` pattern already used for the Function App's own storage account). Wired into `infra-phase1/main-phase1.bicep` alongside the other modules. **Not deployed until the owner approves** - Bicep code ships, actual provisioning is an owner-gated live-infra action like every other resource change this project.
- **`functions-restapi/sql/migration-017-detours.sql`** also adds:
  ```sql
  CREATE TABLE DetourImages (
      id            UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
      detour_id     UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
      blob_path     NVARCHAR(500) NOT NULL,
      file_name     NVARCHAR(255) NOT NULL,
      content_type  NVARCHAR(100) NULL,
      size_bytes    INT NULL,
      caption       NVARCHAR(500) NULL,
      sort_order    INT NOT NULL DEFAULT 0,
      uploaded_by   NVARCHAR(200) NOT NULL,
      uploaded_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  ```
- **`functions-restapi/src/lib/blobStorage.ts`** (new) - thin wrapper around `@azure/storage-blob` (new dependency): `getUploadSasUrl(blobPath)` / `getReadSasUrl(blobPath)`, both short-lived (e.g. 15 min), using the Function App's managed identity to sign (`generateBlobSASQueryParameters` via a user-delegation key - no storage account key ever handled, consistent with the rest of this codebase's zero-standing-secret identity conventions).
- **`POST /detours/{id}/images/upload-url`** (same role as B2's edit access, per the owner's decision) - returns a SAS write URL scoped to one new blob path (`detours/{detourId}/{uuid}-{filename}`).
- **`POST /detours/{id}/images`** - creates the `DetourImages` row once the client's direct-to-Blob upload succeeds.
- **`GET /detours/{id}/images`** - returns image metadata + a fresh short-lived SAS **read** URL per image (never a permanent/public URL).
- Unit tests for the SAS-URL-building pure logic (path construction, expiry math) - the actual Azure SDK call itself isn't unit-testable without a live account, same limitation as every other external-API integration in this repo (mitigated the same way: guard clauses + graceful error surfacing, verified for real once Blob Storage is actually provisioned).
- **Frontend**: multi-file upload control in the `Detours.tsx` entry form (client-side resize via `<canvas>`-based downscale before upload - a small new `frontend/packages/onboard-console/src/lib/imageResize.ts` helper, no new dependency needed for a basic canvas resize), thumbnail row + click-through in the detail panel.
- **Retention**: a new lightweight timer, **`functions-restapi/src/functions/detourImagesPurge.ts`** - daily, deletes `DetourImages` rows (and their blobs) for detours whose `end_date` has passed by more than a short grace window (e.g. 30 days - long enough for a dispute/QA look-back, short enough to satisfy the privacy concern the brief raised). Named constant, clearly commented, easy to tune later.

### B4. Avail Detours sync (once B1-B3 are stable)

- **`functions-restapi/src/lib/availDetoursFeed.ts`** (new) - `fetchDetours(baseUrl, apiKey)` hitting `https://avail360-api.myavail.cloud/Detours/v1/MVTA` (confirmed production host/property per the brief), grouping the response's multiple-rows-per-`DetourID` (one per direction) into one `Detours` row + N `DetourSegments` rows. **Same unconfirmed-envelope caveat as every other Avail feed this project** - the brief itself flags the nested array key as unverified ("confirm the nested `"detours"` array key name... isn't a copy-paste artifact"); this will be guessed the same documented way and flagged for verification against a real response.
- **`functions-restapi/src/functions/availDetoursSync.ts`** (new) - timer (`"0 */15 * * * *"` - 15 min, per the brief's suggested starting cadence), upserts by `external_detour_id`, and **never touches a `source = 'manual'` row**. For an existing `source = 'avail'` row, honors B5's decision below.
- **`DetourStops` feed is explicitly not built on** in this pass, per the brief's own recommendation - it doesn't carry "riders directed to" semantics and isn't worth the integration yet.
- **New app settings** `AVAIL_DETOURS_URL` (imperative, same convention as every other feed URL) - reuses the existing `AVAIL_AVL_REPORTS_API_KEY` unless the owner later confirms Detours needs a separate production key (per the brief's own open question #6 - flagged, not assumed).

### B5. Sync-overwrite behavior

`last_edited_manually` (added in B1) resolves this cleanly: when `availDetoursSync.ts` finds an existing `source='avail'` row with `last_edited_manually = 1`, it **skips overwriting that row's editable fields** (closure text, dates, segments) but still updates a lightweight "last seen in Avail at" timestamp so staff can tell the sync is still tracking it. This is the safer default (preserves a human correction rather than silently reverting it) - flagged as the assumption being made, easy to flip to always-overwrite later if the owner prefers that instead once real sync behavior is observed.

---

## Files to touch/add
- Part A: `functions-restapi/sql/migration-016-route-classification.sql` (new), `src/functions/routeClassification.ts` (new), `src/functions/eventVehiclePositions.ts` (new), `src/functions/availAvlPoll.ts` (extend), `frontend/packages/onboard-console/src/routes/Admin.tsx` (extend), `frontend/packages/onboard-console/src/routes/modules/EventMonitoring.tsx` (extend), `frontend/packages/shared/src/types.ts`/`api.ts`
- Part B: `functions-restapi/sql/migration-017-detours.sql` (new), `src/lib/detourStatus.ts` (new), `src/lib/blobStorage.ts` (new), `src/lib/availDetoursFeed.ts` (new, Phase B4), `src/functions/detours*.ts` (new, several - CRUD + images + purge timer), `src/functions/availDetoursSync.ts` (new, Phase B4), `infra-phase1/modules/storage-detour-images.bicep` (new), `infra-phase1/main-phase1.bicep` (wire the new module), `frontend/packages/onboard-console/src/routes/Detours.tsx` (new), `src/lib/imageResize.ts` (new), `App.tsx`, `frontend/packages/shared/src/types.ts`/`api.ts`
- `functions-restapi/package.json` (new dependency: `@azure/storage-blob`)
- `CHANGELOG.md`, `HANDOFF.md`

---

## Recommended build sequence
1. **Part B1-B2** (Detour schema + manual CRUD + console module) - highest immediate value per the brief's own framing ("reproduces the working artifact, solves the three-places problem"), zero new infra dependency, ships independently of everything else here.
2. **Part A1** (`RouteClassification` table + Admin.tsx section) - cheap, unblocks A2 later, useful on its own for future Avail feed work even before Part A2/A3 land.
3. **Part A2-A3** (event-bus filtering in the existing AVL poller + `EventMonitoring.tsx` panel) - small once A1 exists.
4. **Part B3** (image attachments) - the first piece needing owner infra action (Blob Storage bicep deploy) and a new dependency; natural pause point for sign-off before provisioning.
5. **Part B4-B5** (Avail Detours sync + overwrite behavior) - last, since it depends on the open questions in the brief (subscription key, polling cadence, envelope verification) that need a real API response to resolve properly, same pattern as every other "verify against a real response" caveat this project.

## Verification (per part, as each is implemented)
- `npm run build && npm test` in `functions-restapi` - new unit tests for `computeDetourStatus` (all five states, boundary dates) and the SAS-URL-building pure logic.
- `npm run build` in `frontend`.
- Browser pass per part: Detours module CRUD + status tabs + image upload (mocked SAS flow) in mock-auth preview; RouteClassification editor in Admin.tsx; EventMonitoring's new event-bus panel showing its correct empty state before any classification rows exist, then correct filtering once a mocked `SpecialEvent` row is added.
- **Owner actions (blocking, live environment, sequenced per the build order above):**
  1. Run migration-016/017 against the dev DB.
  2. Confirm/obtain the Avail Detours production subscription key (may differ from the test-environment key per the brief's own open question) and the `AVAIL_DETOURS_URL` app setting.
  3. Approve and deploy the new Blob Storage Bicep module before Part B3 goes live (new resource, real cost - flag explicitly before deploying, same as the Anthropic API key's cost-surface flag earlier this project).
  4. Deploy code per part.
