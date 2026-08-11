# Detour feature evaluation

**Evaluation date:** 2026-08-10  
**Scope:** REST API, SQL migrations, staff console, Avail integration, and deployment notes.

**Verification update:** Rechecked against the current repository on 2026-08-10.
`functions-restapi` passes `npm test` with **260/260** tests passing, including
the detour status, workflow, Avail-feed, numbering, attachment, validation, and
intake tests. The frontend workspace passes `npm run build` for shared, rider,
and onboard-console packages. These are source/build checks; they do not prove
that deployment-dependent resources or live Avail data are configured.

## Executive assessment

The detour module is a strong internal operational record system. The delivered
surface covers manual detour/closure management, Avail-backed records, computed
temporal status, reporting/search, attachments, intake review, workflow states,
role boundaries, and soft deletion. The source and automated tests are in good
shape: the REST API has a clean build with 260 passing tests, and the frontend
production build succeeds.

It is not yet a complete end-to-end detour operating workflow. The largest
missing capabilities are reviewed notification drafting/sending, conflict
warnings with required overrides, map-based intake, and spreadsheet migration.
Several implemented features also require deployment/configuration work before
they are operationally available.

## Capability matrix

| Capability | Status | Evidence / notes |
|---|---|---|
| Authoritative detour/closure CRUD | **Implemented** | `POST/PATCH/GET/DELETE /detours`; delete is a soft delete and role-gated. See `detoursCreate.ts`, `detoursUpdate.ts`, `detoursList.ts`, `detoursDelete.ts`. |
| Route/direction segments | **Implemented** | `DetourSegments` supports ordered route/direction entries for manual and Avail records. |
| Date-derived temporal status | **Implemented** | Shared server calculation produces Monitor, Upcoming, Active, Recently finished, or Expired. Boundary behavior and SQL `DATE`/JavaScript `Date` handling are tested in `detourStatus.test.ts`. |
| Internal reference numbering | **Implemented in source** | `MVTA-DET-YYYY-####` allocator and backfill exist in migration 024 and `detourNumberAllocator.ts`. Deployment notes state the allocator code still needed deployment when last handed off. |
| Reporting fields and reason categories | **Implemented in source** | Migration 025, optional fields, admin-editable reason codes, severity, notification flags, and resolution notes are present. The field vocabulary remains explicitly draft pending confirmation against the real MVTA form. |
| Detour Reports search/filter/export | **Implemented** | Read-only `/detour-reports` page; client-side search, status/reason/severity/source/date filters, and CSV export. |
| Avail Detours synchronization | **Implemented in source** | 15-minute timer, grouping by external DetourID, upsert of `source='avail'`, last-seen tracking, and protection of manual rows. Feed tests cover the lowercase `result.detours` envelope. Live non-zero production behavior still needs confirmation per `HANDOFF.md`. |
| Preliminary intake | **Implemented in source** | `DetourIntake` persistence and console page; create, reject, duplicate, and promote-to-authoritative flows are present. |
| Fulfillment modes | **Implemented in source** | `avail`, `fixed_route_manual`, and `mobility_manual` are modeled. Manual modes bypass Avail-only transitions; Avail mode requires build confirmation before activation. |
| Workflow lifecycle | **Implemented in source** | Workflow PATCH endpoint and transition rules exist. Temporal status remains separate from lifecycle state. Migration 041 supplies the schema. |
| Image attachments | **Implemented in source; deployment-dependent** | Private Blob/SAS upload and authenticated read endpoints, metadata table, and one-year purge logic exist. The deployment handoff says the storage account, app setting, RBAC, and CORS still need provisioning. |
| Role separation | **Implemented in source** | Read, create/edit, attachment, and delete roles are separated; `OCC.Detour` cannot delete. Entra app-role registration/assignment is still a deployment action. |
| Clone/re-establish | **Partially implemented** | The console pre-fills a new manual record and clears dates/sent flags. There is no dedicated backend clone endpoint, audit linkage, or explicit workflow restart contract. |
| Conflict/duplicate warnings | **Not implemented** | `dateWindowsOverlap` exists as a pure helper, but no API/UI path finds likely duplicates, checks stop/segment conflicts, records an override reason, or retains an override audit. |
| Notification drafts and explicit send | **Not implemented** | Existing legacy boolean flags are editable/reportable, but there is no notification-draft endpoint, recipient-group model, sender integration, publication gate, or notification history. |
| Map drawing and nearby-stop detection | **Not implemented** | No detour-specific map/geometry or GTFS nearby-stop workflow is present. |
| Spreadsheet migration | **Not implemented** | No migration/import utility for the legacy tracker was found. |
| Public rider publication | **Intentionally out of scope** | The internal module does not replace the Avail/GTFS rider-facing publication path. |

## Operational caveats

1. **Source completeness is ahead of deployment.** `HANDOFF.md` records that
   migration 024 and migration 025 were applied to dev while their corresponding
   code was not yet deployed at the time of handoff. Confirm deployed function
   code before relying on numbering or reporting fields.
2. **Attachments are unavailable until infrastructure is provisioned.** Deploy
   `infra-phase1/modules/storage-detour-images.bicep`, configure
   `DETOUR_IMAGES_STORAGE_ACCOUNT`, grant the Function App managed identity Blob
   Data Contributor, and verify Blob CORS.
3. **The Avail timer is not proof of synchronization.** Confirm the configured
   URL/key and inspect timer output for mapped records; an empty feed response
   must not be interpreted as confirmation that live detours are absent.
4. **Reason categories and reporting fields are provisional.** They should be
   reconciled with the actual internal form before becoming a governed reporting
   contract.
5. **Client-side reporting search assumes a manageable row count.** If detour
   history grows materially, add server-side filtering/pagination rather than
   loading the complete history into the browser.

## Recommended next actions

### Priority 1 — make the current module operationally trustworthy

- Confirm deployed REST API/frontend versions against migrations 024, 025, and
  041; run the internal-number gap backfill if required.
- Provision and test the private image store, including RBAC, CORS, SAS upload,
  authenticated read, and purge behavior.
- Verify the Avail timer against live data and document the observed feed shape,
  count, and last-seen behavior.
- Confirm the reporting field list and reason-code seed with the actual MVTA
  operating form.

### Priority 2 — close the workflow gaps

- Add duplicate/conflict detection at intake promotion and Avail ingestion;
  require and audit an override reason.
- Add notification drafts with separate internal/contractor recipients and an
  explicit publish/send action. Preserve an immutable sent-body snapshot.
- Decide whether clone is sufficient as a UI convenience or needs a first-class
  API operation with source linkage and audit semantics.

### Priority 3 — planned efficiency features

- Add fixed-route map drawing and nearby GTFS stop suggestions.
- Build a reviewed spreadsheet import that creates authoritative manual detours
  and preserves legacy tracker fields.
- Move reports to server-side search/pagination once row volume justifies it.

## Verification performed

- `functions-restapi`: `npm test` — **260 passed, 0 failed** on the current tree.
- `frontend`: `npm run build` — **passed** for shared package, rider app, and
  onboard console. Vite emitted existing bundle-size/dynamic-import warnings;
  they did not fail the build.

The evaluation is based on repository source, migrations, tests, and the
deployment caveats recorded in `HANDOFF.md`; it does not claim that every
deployment-dependent feature was live in Azure at evaluation time.
