# Detour feature evaluation

**Evaluation date:** 2026-09-04 (supersedes the 2026-08-10 evaluation)  
**Scope:** REST API, SQL migrations, staff console (Detours & Closures, Detour Intake, Detour Reports, Administration), Avail integration, and deployment notes.  
**Tree evaluated:** branch `claude/intelligent-vaughan-fd0fc9` as proposed in PR #137 (console v1.5.95).

**Verification:** `functions-restapi` builds clean and passes `npm test` with **455/455** (one pre-existing skip). The frontend workspace typechecks across shared, rider-app, and onboard-console; the onboard-console production build succeeds; `npm test` passes **156/156**. These are source, build, and unit checks. They do not prove that deployment-dependent resources or live Avail data are configured, and no browser session was run against a live API.

## Executive assessment

The detour module is now a coherent end-to-end internal operating record: a field
report enters through Detour Intake as a complete operational record, is
reviewed by OCC with duplicate warnings, can be returned for information and
resubmitted, is accepted as the same record into the authoritative Detour, moves
through fulfillment (Avail entry, manual fallback, closure) with an append-only
history, and is searchable and exportable with every field it carries. The
review that produced PR #137 found that most of the module's earlier gaps were
data that was captured but never shown, and workflow states with no exit; those
are closed.

Every capability the specs asked for now exists in source. Attachments, the
map, email and Teams delivery, and the Avail feed remain deployment-dependent.

## Capability matrix

| Capability | Status | Evidence / notes |
|---|---|---|
| Authoritative detour/closure CRUD | **Implemented** | `POST/PATCH/GET/DELETE /detours`; soft delete, role-gated. `detoursCreate.ts`, `detoursUpdate.ts`, `detoursList.ts`, `detoursDelete.ts`. |
| Route/direction segments | **Implemented** | `DetourSegments`, ordered; carried across from intake segments on acceptance. |
| Date-derived temporal status | **Implemented** | Server-computed Monitor / Upcoming / Active / Recently finished / Expired; `detourStatus.test.ts`. TIME columns serialize as `HH:MM` (`toTimeOnly`). |
| Internal reference numbering | **Implemented** | `MVTA-DET-YYYY-####`, migration 024, `detourNumberAllocator.ts`; year-mismatch warning in the console. |
| Reporting fields and reason categories | **Implemented** | Migration 025; reason codes are now **admin-manageable in the console** (Administration → Service Configuration: add, rename, reorder, retire). Field vocabulary still provisional against the real MVTA form. |
| Operational record on the Detour | **Implemented** | Window times and status, service impact/area, location, affected stops, action instructions, operational impacts, required audiences/channels, confirmation contact, evidence (migrations 056/057/069/088). Selected under schema guards, rendered on both pages, searchable, exported. |
| Detour Reports search/filter/export | **Implemented** | Read-only page; client-side search, status/reason/severity/source/date filters. CSV **matches the table** (table and export share `detourLabels.ts`; parity test). |
| Legacy spreadsheet import | **Implemented** | `POST/GET /detours/historical-imports` (migration 060). RFC 4180 parser with header-name column mapping; rows listed and searchable on Reports; uploader shown to write roles only. Rows are evidence, never approvals. |
| Preliminary intake | **Implemented** | Complete-record form; pending / needs-information / decided queues; edit, update-and-resubmit (`PUT /detour-intake/{id}`), withdraw, reject, duplicate; review decisions governed by a pure transition matrix. |
| Likely-duplicate warnings | **Implemented** | `detourDuplicates.ts`: drawn shapes within 75 m, a shared GTFS stop (within 100 m of a drawing, or a `#stop_id` marker in affected stops), or a shared route number or place word, inside an overlapping window, against non-closed Detours and other open intake. Warns and lets the reviewer pick the target; never merges or rejects. |
| Same-record acceptance | **Implemented** | Promotion keeps the intake id as the Detour id, re-parents supporting files, writes the operational record, allocates the internal number, records history. |
| Fulfillment modes and workflow lifecycle | **Implemented** | `avail`, `fixed_route_manual`, `mobility_manual`; `approved → awaiting_fulfillment → fulfilled / fulfillment_failed → closed` with `canTransition`; readiness derived. Console actions: record Avail entry, manual fallback, close. |
| OCC re-review after material edit | **Implemented** | Edits flag `review_status = needs_review`; `POST /detours/{id}/review-complete` clears it and writes a `manual_correction` history row. |
| Workflow history | **Implemented** | Append-only `DetourWorkflowHistory`; visible behind "Show history" on both pages. |
| Communications (internal drafts and delivery) | **Implemented; delivery deployment-dependent** | Per-detour drafts work through the record's required audiences (checklist, per-audience prefill, Other escape). Publishing with send freezes subject/body/recipients on the row (migration 092), enqueues `detour-communication-requested`, and the dispatch app delivers by ACS email per recipient, writing back sent / partially sent / failed / skipped. `communication_status` counts only communications that were delivered or that a human marked published. Teams-channel communications post inline through `TEAMS_DETOUR_WEBHOOK_URL` (Adaptive Card; own Key Vault secret in `functionapp.bicep`). Needs the Service Bus queue (bicep) and `ACS_ENDPOINT`/`ACS_EMAIL_FROM` on the dispatch app for email, and the Teams secret for Teams; without them the console falls back to Open in email / Mark published. Radio remains a human channel. Detour Reports lists each communication with delivery state and the sent copy. Per-recipient receipts (migration 093) arrive from ACS via Event Grid to the dispatch app's `/api/acs-email-events`; "Delivered" means every recipient's receipt is Delivered, "Accepted by provider" until then. Needs an Event Grid subscription on the ACS resource (portal). |
| Contractor notification | **Implemented (manual send)** | Design B15. Contractor name and recipients in AppSettings (migration 089, admin-editable); fixed-route Detours require a published communication to the contractor; the composer prefills recipients and offers an Open-in-email link; publishing records the outcome. No server-side sender - delivery is a human action from the staff member's mail client. |
| Avail Detours synchronization | **Implemented in source; live behavior unconfirmed** | 15-minute timer (`availDetoursSync.ts`), upsert by external DetourID, last-seen tracking, manual-edit protection. Live feed shape and non-zero behavior still need confirmation per `HANDOFF.md`. |
| Image/document attachments | **Implemented in source; deployment-dependent** | Private Blob/SAS upload and read for detours and intake (`DetourImages`), daily purge timer. Images render as thumbnails and documents as file tiles on Detours & Closures (editable) and Detour Reports (read-only); the accept list matches intake. Storage account, app setting, RBAC, and CORS still need provisioning (`infra-phase1/modules/storage-detour-images.bicep`). |
| Role separation | **Implemented** | Read / intake (admin) / write / delete separated server-side and mirrored in the console; import and re-review controls hidden from roles that would 403. |
| Clone/re-establish | **Partially implemented** | Console pre-fills a new record and clears dates, sent flags, approval, and resolution. No backend clone endpoint, source linkage, or history row on the new record. |
| Conflict override with reason | **Implemented** | `detourConflicts.ts` runs the same route/place/window matcher Detour to Detour for every open record; `POST /detours/{id}/conflict-override` (migration 090) records reason, actor, and the conflicting ids in the row and in workflow history; the override covers only the conflicts known at the time. Confirming an Avail entry is refused while a conflict is unresolved. Records with a drawn shape also match geometrically (within 75 m) and by shared GTFS stop, ranked above route matches. |
| Map drawing and nearby-stop detection | **Implemented; deployment-dependent** | Intake map (Azure Maps drawing tools) stores a GeoJSON Point/LineString/Polygon (migration 091) carried to the Detour; `POST /gtfs-stops/near` returns stops within a radius with serving routes from the new `GtfsStopRoutes` index; selections feed Affected stops and route segments. Read-only map on review, Detours & Closures, and Reports. Needs `AZURE_MAPS_CLIENT_ID` and a static GTFS sync run after 091 to populate the route index. |
| Public rider publication | **Intentionally out of scope** | Rider-facing publication remains Avail/GTFS. |

## Operational caveats

1. **Migrations 088 through 093 must be applied to dev.** Until it runs, acceptance skips
   the `location` column (guarded) and Detours promoted before this branch keep
   showing the closure location under "Riders directed." The migration also
   performs that backfill. Migration 089 seeds the contractor settings; until
   it runs the Administration section reports them as not seeded. Migration 090
   adds the conflict override columns; until it runs conflicts are still
   reported but cannot be overridden and do not block Avail entry. Migration 091
   adds geometry columns and `GtfsStopRoutes`; run the static GTFS sync after
   it so nearby-stop suggestions carry routes. Migration 092 adds delivery
   columns; until it runs Send email is refused and manual publish still works.
   Migration 093 adds receipts; until it runs and the Event Grid subscription
   exists, emailed communications stop at "Accepted by provider".
2. **Attachments are unavailable until storage is provisioned.** Deploy the
   bicep module, set `DETOUR_IMAGES_STORAGE_ACCOUNT`, grant the Function App
   identity Blob Data Contributor, verify CORS.
3. **The Avail timer is not proof of synchronization.** Inspect timer output
   for mapped records; an empty response is not evidence that no detours exist.
4. **Reason categories and reporting fields are provisional** until reconciled
   with the actual MVTA operating form. The admin section makes reconciliation
   a configuration task rather than a migration.
5. **Client-side search assumes a manageable row count.** Both pages load the
   full detour table (and Reports loads every imported legacy row). The seam to
   move server-side is `detourSearch.ts`; nothing else filters.
6. **Duplicate and conflict detection are strongest for drawn records.**
   Shapes match by distance and by shared GTFS stops; undrawn records match by
   `#stop_id` markers, route numbers, and place words. A prompt for a reviewer,
   not a guarantee - a Detour with no drawing, stops, segments, or place words
   never conflicts.
7. **Deployed code may lag source.** `HANDOFF.md` records earlier cases where a
   migration was applied before its code shipped. Confirm the deployed API and
   console versions before relying on any capability marked implemented here.

## Recommended next actions

### Priority 1 — operational trust

- Apply migration 088 to dev; confirm the `riders_directed` backfill on the
  promoted Detours.
- Provision the attachment store and confirm upload, read, and purge end to end.
- Confirm the Avail timer against live data and record the observed feed shape.
- Reconcile reason categories and reporting fields with the MVTA form.

### Priority 2 — close the outbound workflow

- Decide whether clone/re-establish needs a first-class endpoint with source
  linkage and a `created` history row on the new record.

### Priority 3 — planned efficiency features

- Server-side search and pagination once row volume justifies it.

## Change log for this evaluation

The 2026-08-10 evaluation listed conflict/duplicate warnings, notification
drafts, and spreadsheet migration as not implemented, and did not cover
communications, closure, historical import, re-review, or the intake queue.
PR #137 (twenty-one commits, v1.5.75–1.5.95) added the operational record read path,
the needs-information workflow, re-review clearance, CSV/table parity, removal
of twelve client methods with no server, workflow history and reason-code
admin in the console, `Detours.location`, legacy-import listing and a real
CSV parser, likely-duplicate detection, a testable intake column list, and
type-aware attachment rendering, communications prefilled from the record's required
audiences, contractor notification with a manual send path, conflict override on the
authoritative Detour, map drawing with nearby-stop suggestions, and server-side
email and Teams delivery with a sent snapshot, per-recipient receipts, a delivery view on Reports, and map- and
stop-based duplicate and conflict matching.
This document reflects the tree after those changes.
