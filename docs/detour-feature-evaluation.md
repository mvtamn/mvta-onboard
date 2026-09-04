# Detour feature evaluation

**Evaluation date:** 2026-09-04 (supersedes the 2026-08-10 evaluation)  
**Scope:** REST API, SQL migrations, staff console (Detours & Closures, Detour Intake, Detour Reports, Administration), Avail integration, and deployment notes.  
**Tree evaluated:** branch `claude/intelligent-vaughan-fd0fc9` as proposed in PR #137 (console v1.5.83).

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

What remains missing is the outbound side: reviewed notification drafting with
an explicit send to internal and contractor recipients, and the map-based
intake aids. Attachments and the Avail feed remain deployment-dependent.

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
| Likely-duplicate warnings | **Implemented** | `detourDuplicates.ts`: shared route number or place word inside an overlapping window, against non-closed Detours and other open intake. Warns and lets the reviewer pick the target; never merges or rejects. |
| Same-record acceptance | **Implemented** | Promotion keeps the intake id as the Detour id, re-parents supporting files, writes the operational record, allocates the internal number, records history. |
| Fulfillment modes and workflow lifecycle | **Implemented** | `avail`, `fixed_route_manual`, `mobility_manual`; `approved → awaiting_fulfillment → fulfilled / fulfillment_failed → closed` with `canTransition`; readiness derived. Console actions: record Avail entry, manual fallback, close. |
| OCC re-review after material edit | **Implemented** | Edits flag `review_status = needs_review`; `POST /detours/{id}/review-complete` clears it and writes a `manual_correction` history row. |
| Workflow history | **Implemented** | Append-only `DetourWorkflowHistory`; visible behind "Show history" on both pages. |
| Communications (internal drafts) | **Partially implemented** | Per-detour drafts with a publish action; `communication_status` derived by comparing published audiences to the required list. The composer works through the record's required audiences and channels (checklist with progress, per-audience Draft that prefills a message from the operational record, Other escape for unplanned audiences). No recipient-group model, no sender integration (email/Teams), and no immutable sent-body snapshot - "published" records a decision, not a delivery. |
| Contractor notification | **Implemented (manual send)** | Design B15. Contractor name and recipients in AppSettings (migration 089, admin-editable); fixed-route Detours require a published communication to the contractor; the composer prefills recipients and offers an Open-in-email link; publishing records the outcome. No server-side sender - delivery is a human action from the staff member's mail client. |
| Avail Detours synchronization | **Implemented in source; live behavior unconfirmed** | 15-minute timer (`availDetoursSync.ts`), upsert by external DetourID, last-seen tracking, manual-edit protection. Live feed shape and non-zero behavior still need confirmation per `HANDOFF.md`. |
| Image/document attachments | **Implemented in source; deployment-dependent** | Private Blob/SAS upload and read for detours and intake (`DetourImages`), daily purge timer. Images render as thumbnails and documents as file tiles on Detours & Closures (editable) and Detour Reports (read-only); the accept list matches intake. Storage account, app setting, RBAC, and CORS still need provisioning (`infra-phase1/modules/storage-detour-images.bicep`). |
| Role separation | **Implemented** | Read / intake (admin) / write / delete separated server-side and mirrored in the console; import and re-review controls hidden from roles that would 403. |
| Clone/re-establish | **Partially implemented** | Console pre-fills a new record and clears dates, sent flags, approval, and resolution. No backend clone endpoint, source linkage, or history row on the new record. |
| Conflict override with reason | **Not implemented** | Duplicate detection warns at intake, but there is no per-stop/segment conflict check on the authoritative Detour and no recorded override reason. (Events have this; detours do not.) |
| Map drawing and nearby-stop detection | **Not implemented** | No detour geometry or GTFS nearby-stop workflow. |
| Public rider publication | **Intentionally out of scope** | Rider-facing publication remains Avail/GTFS. |

## Operational caveats

1. **Migrations 088 and 089 must be applied to dev.** Until it runs, acceptance skips
   the `location` column (guarded) and Detours promoted before this branch keep
   showing the closure location under "Riders directed." The migration also
   performs that backfill. Migration 089 seeds the contractor settings; until
   it runs the Administration section reports them as not seeded.
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
6. **Duplicate detection is lexical.** It matches route numbers and place
   words, not stop IDs or geometry. It is a reviewer prompt, not a guarantee.
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

- A server-side sender (email/Teams) with an immutable sent-body snapshot, so
  "published" can mean delivered rather than recorded.
- An explicit send with a sender integration and an immutable sent-body
  snapshot; `communication_status` should derive from sends, not from drafts
  marked published.
- Decide whether clone/re-establish needs a first-class endpoint with source
  linkage and a `created` history row on the new record.

### Priority 3 — planned efficiency features

- Stop/segment conflict check on the authoritative Detour with a required,
  audited override reason.
- Fixed-route map drawing and GTFS nearby-stop suggestions at intake.
- Server-side search and pagination once row volume justifies it.

## Change log for this evaluation

The 2026-08-10 evaluation listed conflict/duplicate warnings, notification
drafts, and spreadsheet migration as not implemented, and did not cover
communications, closure, historical import, re-review, or the intake queue.
PR #137 (thirteen commits, v1.5.71–1.5.83) added the operational record read path,
the needs-information workflow, re-review clearance, CSV/table parity, removal
of twelve client methods with no server, workflow history and reason-code
admin in the console, `Detours.location`, legacy-import listing and a real
CSV parser, likely-duplicate detection, a testable intake column list, and
type-aware attachment rendering, communications prefilled from the record's required
audiences, and contractor notification with a manual send path.
This document reflects the tree after those changes.
