# Decision Matrix gap analysis and implementation plan

**Baseline reviewed:** 2026-08-22, repository `HEAD` `a33a638`  
**Decision captured for this analysis:** the OnBoard app owns Decision Matrix
content and its governance. SharePoint is supporting-document storage only; it
does not author or synchronize Criteria, Immediate actions, or other Matrix
content into the app.

## Scope and source hierarchy

This analysis covers the Decision Matrix reference layer and the planned
operational-procedure layer. It reconciles the current repository with the
product direction and is the baseline for an implementation specification.

Sources have different authority and currency:

| Source | Use in this analysis | Status |
| --- | --- | --- |
| [`CONTEXT.md`](../CONTEXT.md#L723-L742) | Domain vocabulary. | Authoritative vocabulary, but its statement that the source document is maintained in SharePoint conflicts with the decision above and needs correction. |
| [`MVTA_ONBOARD_MANUAL.md`](../MVTA_ONBOARD_MANUAL.md#L642-L654) | Product direction for a versioned Procedure and future operational workflow. | Directionally current; its claim that the Matrix is static/limited is stale. |
| [`plans/SUGGESTED_IMPROVEMENTS.md` §13](../plans/SUGGESTED_IMPROVEMENTS.md#L698-L791) | Historical requirements input. | Useful for procedure fields, exception workflow, and reporting; the manual supersedes it where they differ. |
| [`docs/decision-matrix-feature-evaluation.md`](decision-matrix-feature-evaluation.md#L6-L38) | Earlier UI assessment. | Its reference-vs-operational layering remains useful, but its bundled mock-data, QRG, role, accessibility, and absent-governance claims predate the current implementation. |
| Current migration, API, shared types, UI, and tests cited below | Implemented behavior. | Source of truth for what is in this checkout; it does not establish what is deployed in an environment. |

`CURRENT_STATE.md` and `README.md` still say that the Matrix is not fully
production connected or is `OCC.Admin`-gated
([`CURRENT_STATE.md`](../CURRENT_STATE.md#L100-L103),
[`README.md`](../README.md#L14-L24)). Those statements no longer describe the
current code and should not drive scope. The changelog's printed-QRG entry is
historical context, not the current data model
([`CHANGELOG.md`](../CHANGELOG.md#L1101-L1103)).

## Source-grounded current state

### What is implemented

- A `DecisionMatrixProcedures` table stores procedure/revision identity,
  criteria, JSON immediate actions, escalation and notification fields,
  document metadata, owner/approval/review fields, and trust/source status.
  It has a composite procedure/revision key and a seeded approved record.
  [`migration-051`](../functions-restapi/sql/migration-051-decision-matrix-procedures.sql#L1-L73)
- `GET /decision-matrix` reads governed SQL records. Staff receive approved,
  non-retired records; an `OCC.Admin` can request history. The endpoint reports
  an explicit unavailable diagnostic when the table has not been migrated.
  [`decisionMatrix.ts`](../functions-restapi/src/functions/decisionMatrix.ts#L91-L138)
- The UI uses that API, presents loading/error/unavailable states, trust-state,
  document-type, and accessible tag filters, clear-all, ordered actions, and
  Scan/Browse/QRG presentations from the same record shape.
  [`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L18-L151)
- The console route is available to `OCC.Viewer`, `OCC.Publisher`, and
  `OCC.Admin`; the API's staff-read set additionally includes `OCC.EventAVL`.
  Approval/retirement and the current sync endpoint are admin-only.
  [`App.tsx`](../frontend/packages/onboard-console/src/App.tsx#L52-L56),
  [`App.tsx`](../frontend/packages/onboard-console/src/App.tsx#L415-L422),
  [`auth.ts`](../functions-restapi/src/lib/auth.ts#L69-L80),
  [`decisionMatrixGovernance.ts`](../functions-restapi/src/functions/decisionMatrixGovernance.ts#L5-L49)
- A Procedure-match endpoint searches approved records, and Suggested Alerts,
  fixed-route risk, and on-demand quality link a user into the Matrix with a
  contextual search query. These are recommendations, not persisted
  operational records.
  [`decisionMatrixMatches.ts`](../functions-restapi/src/functions/decisionMatrixMatches.ts#L30-L83),
  [`SuggestedAlerts.tsx`](../frontend/packages/onboard-console/src/routes/SuggestedAlerts.tsx#L134-L138),
  [`FixedRouteServiceRisk.tsx`](../frontend/packages/onboard-console/src/routes/modules/FixedRouteServiceRisk.tsx#L682-L686),
  [`OnDemandServiceQuality.tsx`](../frontend/packages/onboard-console/src/routes/modules/OnDemandServiceQuality.tsx#L378-L382)
- The current UI test covers governed rendering, filter reset, and API failure.
  [`DecisionMatrix.test.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.test.tsx#L1-L54)

### What is implemented but conflicts with the intended boundary

The button labeled **“Sync SharePoint source”** calls an admin endpoint and a
six-hour timer. That code fetches a generic JSON payload, then inserts or
updates Criteria, Immediate actions, notifications, tags, governance metadata,
and document fields; a matched approved revision is protected from overwrite.
[`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L104-L115)
[`decisionMatrixSync.ts`](../functions-restapi/src/functions/decisionMatrixSync.ts#L5-L98)
[`decisionMatrixSync.ts`](../functions-restapi/src/functions/decisionMatrixSync.ts#L100-L121)

This is a content-import integration, not a SharePoint document-reference
check. It must be replaced, not merely relabeled, to keep the Matrix app-owned.

## Target operating model

The model below applies the product decision while preserving the useful
separation between reference and operational layers described in the earlier
evaluation ([reference/operational layers](decision-matrix-feature-evaluation.md#L75-L88)).

| Concern | Owner and behavior |
| --- | --- |
| **Procedure and Decision Matrix revision** | The app owns the canonical structured record: condition, criteria, ordered immediate actions, notifications, escalation, communication and documentation guidance, tags, trust state, and approval lifecycle. An approved revision is immutable. |
| **Criteria** | App authors create observable inclusion/exclusion criteria. A criterion needs stable identity, order, text, and type at minimum so revisions and later matching can be reasoned about. It must not be extracted automatically from a document. |
| **Immediate actions** | App authors create an ordered action list. Each action needs stable identity, display order, instruction, and a decision on whether a later procedure instance requires it, permits it to be skipped, or marks it informational. |
| **Supporting documents** | SharePoint stores the SOP/REF files. A Matrix revision holds one or more document references, including document type, document code/title, SharePoint locator, expected document revision, required/optional flag, and link-validation status. The document is opened from the app; it does not overwrite Matrix content. |
| **SharePoint check** | A background/manual **Check document references** operation validates the referenced file and refreshes only document metadata/status/check time. Missing, inaccessible, or revision-mismatched documents make the reference visibly unavailable/needs-review according to policy; they never mutate Criteria or actions. |
| **Operational procedure instance** | A later app-owned record connects an exception or manual incident to the exact approved Procedure revision shown, then records acknowledgement, assignments, action outcomes, notes, escalation, communication handoff, resolution, and audit events. This remains unimplemented. |

This target retains the manual's requested procedure content and procedure
revision on an operational event
([`MVTA_ONBOARD_MANUAL.md`](../MVTA_ONBOARD_MANUAL.md#L646-L654)) and the
proposal's requirement that justified deviations remain possible
([`plans/SUGGESTED_IMPROVEMENTS.md`](../plans/SUGGESTED_IMPROVEMENTS.md#L763-L791)).

## Prioritized gaps

| Priority | Gap and evidence | Required outcome |
| --- | --- | --- |
| P0 | **Content ownership is inverted by the sync job.** The implementation imports every structured Matrix field from `DECISION_MATRIX_SHAREPOINT_URL` and runs it on a timer. [`decisionMatrixSync.ts`](../functions-restapi/src/functions/decisionMatrixSync.ts#L30-L98) | Retire content import and its timer. Replace it with document-reference validation that cannot write Matrix content. |
| P0 | **There is no app authoring or revision workflow.** Current APIs read records, approve/retire a supplied revision, or import one; there is no create, edit-draft, submit-for-approval, clone/revise, or document-reference endpoint. [`api.ts`](../frontend/packages/shared/src/api.ts#L313-L349) | Deliver app-owned draft/revision authoring, validation, review, approval/publish, supersession, and retirement. Never edit an approved revision in place. |
| P0 | **Criteria, actions, and document references are not fully specified.** The schema holds Criteria as text, actions as an untyped string JSON array, and one `source_url`/document code per revision. Database checks only establish JSON validity and SOP/REF type. [`migration-051`](../functions-restapi/sql/migration-051-decision-matrix-procedures.sql#L5-L45) | Specify field rules and migrate to a durable representation that preserves action order/identity and supports multiple, version-aligned document references. |
| P0 | **No immutable governance audit trail exists.** Approval/retirement updates the procedure row; the supplied reason is written to a log message but not a procedure audit table. [`decisionMatrixGovernance.ts`](../functions-restapi/src/functions/decisionMatrixGovernance.ts#L26-L43) | Persist append-only lifecycle/change events with actor, time, action, reason, before/after revision identity, and correlation ID. Define retention and who can see the history. |
| P1 | **Document-reference health is only a field, not an observed check.** `source_status` and `last_synced_at` exist, but the existing sync unconditionally marks imported rows available and does not validate a SharePoint file, permissions, or document revision. [`decisionMatrixSync.ts`](../functions-restapi/src/functions/decisionMatrixSync.ts#L72-L97) | Define the SharePoint locator, authentication, metadata/revision comparison, retry/failure policy, and UI status. Show last checked and a useful access/error path. |
| P1 | **Trust metadata is not fully actionable in the UI.** The row shows trust, owner, and next review date, while effective date, document check time, source revision, and the reason for a trust state are not shown. [`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L126-L151) | Display enough provenance to decide whether to rely on a procedure: revision, effective date, owner, approver, next review, document-reference status/last check, and reason for partial/stale/unavailable. |
| P1 | **Search is not aligned with the UI promise.** The placeholder says actions are searchable, but server search omits `immediate_actions_json`; it also does not search several other content fields. [`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L91-L94) [`decisionMatrix.ts`](../functions-restapi/src/functions/decisionMatrix.ts#L110-L124) | Define a search index/scope that includes condition, criteria, action text, tags, controlled metadata, and document identifiers, then test it. |
| P1 | **Matching and deep linking do not pin a decision.** Links pass keyword queries; the matches endpoint can accept a condition key but the UI currently invokes it with `q`. No workflow persists a selected procedure/revision against the originating record. [`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L45-L58) | Use controlled condition keys/match rules, show match confidence/reason, let the controller select a revision, and retain that selection only once an operational instance exists. |
| P1 | **Role policy is incomplete.** Read and admin governance roles exist, but the product has not assigned author, reviewer, approver, publisher, document-reference administrator, or audit-reader permissions. [`auth.ts`](../functions-restapi/src/lib/auth.ts#L69-L80) | Decide least-privilege role capabilities and enforce them in both UI and API. Separate authoring from approval unless an explicit emergency exception is governed. |
| P1 | **The operational layer is absent.** The product direction calls for acknowledgement, action completion, notes, owner, escalation, communications, resolution, and the exact shown revision; the existing Procedure data and UI do not record them. [`MVTA_ONBOARD_MANUAL.md`](../MVTA_ONBOARD_MANUAL.md#L646-L654) | Specify and implement Procedure Instances after reference content is trustworthy; preserve deviations rather than forcing false completion. |
| P2 | **Current tests are narrow.** There is a component test, but no Decision Matrix API, lifecycle, document-validation, authorization, migration, or end-to-end contextual-link test in the identified test files. [`DecisionMatrix.test.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.test.tsx#L30-L54) | Build a test matrix alongside the phases below, including authorization and failure behavior. |
| P2 | **Repository documentation is misleading.** The evaluation, manual/current-state, README, and CONTEXT wording contain stale or contradictory source/role/data claims cited above. | Update documentation only after the operating model is accepted, with the gap analysis as the transition reference. |

## Decisions required before implementation

1. **Procedure lifecycle and segregation of duties.** Which roles may draft,
   edit a draft, submit, review, approve/publish, retire, restore, and invoke
   an emergency separation override? Is a published revision automatically
   effective at approval or scheduled for a future effective time?
2. **Criteria contract.** Are criteria plain ordered statements with
   inclusion/exclusion types, or do they need route/mode/threshold/operator
   decision fields from the first release? The recommended minimum is ordered
   typed statements with stable IDs; do not build automatic document parsing.
3. **Immediate-action contract.** Which actions are mandatory, skippable with a
   reason, informational, or only required for particular procedures? This
   determines the Procedure Instance audit model.
4. **Document-reference contract.** Can a revision link multiple SOP/REF files?
   What stable SharePoint identity is available (site/library/item ID versus
   URL), which document metadata is authoritative, how is expected document
   revision represented, and what status blocks approval versus merely warns?
5. **Document-check implementation and service identity.** Choose the approved
   SharePoint/Graph access path, app permissions, secret/managed-identity
   handling, check cadence, retries, and what can be shown to a staff member
   when access fails. This integration validates references only.
6. **Migration and cutover.** Which existing governed rows are authoritative,
   who validates/rewrites them in the app, and when is the import endpoint and
   timer disabled? The repository cannot establish whether migration 051 or any
   source configuration is deployed.
7. **Operational-instance scope.** Which exception sources create instances,
   when one is created versus merely suggested, who owns it, allowed resolution
   codes, retention, and whether customer-communication handoff is a link or
   an integrated workflow.

## Phased implementation plan

### Phase 0 — confirm the contract and protect current content

1. Approve the decisions above, especially the app/SharePoint boundary and
   role matrix.
2. Inventory every existing Procedure/revision and its supporting document;
   record which data must be retained or rewritten.
3. Disable the automatic content-import timer and prevent the current sync
   endpoint from changing structured Matrix fields. Rename the UI capability
   only when its replacement exists.
4. Update the domain wording and stale status claims after approval.

**Acceptance checkpoint:** no process treats a SharePoint JSON payload as the
authority for Criteria or Immediate actions; the cutover inventory has an
owner and sign-off; rollback and migration paths are documented.

### Phase 1 — app-owned Procedure revisions and governance

1. Model Procedure, immutable Procedure Revision, Criteria, ordered Immediate
   Action, Document Reference, and append-only Procedure Audit Event. Preserve
   the current stable procedure/revision identifiers where feasible.
2. Define API schemas and server validation for all mandatory fields, action
   ordering/stable IDs, controlled values, transition rules, optimistic
   concurrency, and document-reference revision alignment.
3. Implement authoring screens for draft, edit, clone-to-new-revision, submit,
   review, approve/effective, supersede, and retire. An approved revision must
   be rendered read-only.
4. Implement the agreed role matrix on every endpoint; record reasons and
   actor identity in the audit event stream.

**Acceptance checkpoint:** an authorized author can create a complete
procedure in the app; an approver can publish a new revision without changing
the old one; unauthorized or stale/concurrent edits fail safely; audit history
explains every lifecycle transition.

### Phase 2 — SharePoint supporting-document references

1. Implement the chosen locator and validator for SharePoint files. Store the
   retrieved metadata, expected/observed revision, validation result, failure
   reason category, and checked-at time on each document reference.
2. Provide admin/manual and scheduled **Check document references** operations.
   They may update reference-health fields only; they may not create or edit a
   Procedure Revision, Criteria, or Immediate Action.
3. Surface document status, revision mismatch, stale check, and access failure
   in authoring/review and the read-only Matrix. Define whether each state
   blocks publishing or only prevents document opening.
4. Run the preview-first delivery spike described below against the approved
   SharePoint library. Select a delegated or narrowly scoped app-identity
   authorization model and prove only the file types that will be promised;
   do not include an Office/PDF iframe renderer without that result.

**Acceptance checkpoint:** valid documents are confirmed; missing,
unauthorized, changed, and timed-out documents are distinguishable; checks do
not mutate Matrix content; an approved revision keeps a durable reference to
the intended document revision.

### Phase 3 — read experience, search, and recommendations

1. Migrate the Matrix read API/UI to the new revision/document model while
   retaining Scan, Browse, and governed QRG views.
2. Make search behavior match its label and add server/client tests for action,
   criteria, metadata, document code, filters, and trust-state visibility.
3. Use controlled condition keys and explicit match reasons for Suggested
   Alerts and Service Risk. Keep recommendation and selection distinct until a
   Procedure Instance exists.
4. Add the remaining usability work proportionate to operational need: URL
   state for search/filters, result highlighting or focus support, and narrow
   viewport QRG behavior.

**Acceptance checkpoint:** a viewer can identify the exact approved revision,
document status, owner, and review/effective dates; a recommendation is
explainable and never silently selects a procedure; all supported states are
keyboard accessible and tested.

### Phase 4 — Operational Procedure Instances

1. Specify and create the operational exception/instance and append-only
   instance-event model, including procedure/revision pinning, acknowledgement,
   owner, action outcomes/skips with reasons, notes, escalation, communication
   handoff, resolution, and closure.
2. Integrate the selected exception sources. Preserve source identifiers and
   allow manual creation where policy requires it.
3. Implement the controller workspace, assignment/escalation permissions, and
   audit/history view. Support justified deviations explicitly.

**Acceptance checkpoint:** an instance permanently records the revision shown
at acknowledgement, every subsequent action is attributable and ordered, and
an auditor can reconstruct the response without consulting mutable current
procedure content.

### Phase 5 — reporting and operational hardening

1. Deliver reports for procedure use, unmatched exceptions, acknowledgement
   and resolution time, skipped/not-applicable actions, escalation, and repeat
   manual work—the measures proposed in the historical plan
   ([`plans/SUGGESTED_IMPROVEMENTS.md`](../plans/SUGGESTED_IMPROVEMENTS.md#L778-L791)).
2. Define retention, export, privacy, monitoring, alerting, backup/recovery,
   and review-cycle jobs.
3. Reconcile and maintain the manual, context vocabulary, current-state,
   README, and feature evaluation against the accepted implementation.

**Acceptance checkpoint:** reports trace to immutable records, health alerts
cover document-check and workflow failures, and the product documentation no
longer describes SharePoint as the Decision Matrix content source.

## Test matrix to carry into the implementation spec

| Area | Minimum automated coverage |
| --- | --- |
| Data migration | Existing rows migrate once, retain identity/revision, preserve approved history, and reject malformed ordered content. |
| Lifecycle/authorization | Every allowed and forbidden role/action transition; no in-place approved edits; concurrency conflict; audit event includes actor/reason/time. |
| Content validation | Required Criteria/actions/documents, stable action ordering, condition-key uniqueness policy, and revision/document mismatch policy. |
| Document checks | Valid, missing, forbidden, network failure, stale result, revision mismatch, retry, and guarantee of no structured-content mutation. |
| Document preview | Authorized image stream, source-link access, unsupported types, missing/stale rendition, thumbnail absence, CSP, keyboard/screen-reader behavior, and narrow viewport fallback. |
| Read/matching UI | Loading, empty, unavailable, partial, stale, filters, search scope, contextual recommendation, and accessibility at narrow widths. |
| Procedure instances | Revision pinning, acknowledgement, mandatory/skipped actions, ownership, escalation, resolution, audit reconstruction, and retention/export permissions. |

## Preview-first document experience

### Feasibility and boundary

**Yes for a PNG/JPEG rendition; conditionally for other document types.** The
Matrix can present a supplied image rendition as its primary in-app document
experience and keep **Open source document in SharePoint** as the secondary
action. This is compatible with the selected boundary: OnBoard owns the
Procedure; SharePoint remains the store of the supporting original and any
approved rendition.

The current implementation does not do this. A Procedure has only one
`source_url`, rendered as an external `Open SOP/REF` link
([`DecisionMatrix.tsx`](../frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx#L117-L145)).
It has neither stable SharePoint item identity nor a preview endpoint. The
console's CSP admits images only from `self`, `data:`, `blob:`, and Azure Maps,
and frames only from Entra, so direct SharePoint image or iframe URLs would be
blocked today ([`staticwebapp.config.json`](../frontend/packages/onboard-console/public/staticwebapp.config.json#L8)).

SharePoint library files are available through Microsoft Graph `driveItem`s.
Graph can return file bytes and item metadata, including the stable item ID,
MIME type, ETag, last-modified time, and browser-display `webUrl`
([driveItem resource](https://learn.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0)).
For an explicit PNG or JPEG rendition, that is sufficient to place the image
inside a same-origin OnBoard viewer. A Graph thumbnail is also an image
representation for a file or document, but a drive item has *zero or more*
thumbnail sets; it is an opportunistic fallback, not a guaranteed rendition
([Graph thumbnails](https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0)).

Do **not** promise an in-app Office or PDF reader in this phase. Graph's
`preview` operation can return a temporary embeddable URL, but either GET or
POST embedding data can be absent and page/zoom support varies by preview app
([Graph preview](https://learn.microsoft.com/en-us/graph/api/driveitem-preview?view=graph-rest-1.0)). A delivery spike must validate the actual MVTA tenant,
library, document types, and security policy before selecting that as an
approved renderer. Until then, PDF, Word, Excel, PowerPoint, and unsupported
image types show a file-type fallback and the secondary SharePoint action;
they do not silently become an iframe requirement.

### Recommended UX contract

1. Selecting a Procedure opens its document panel or detail view. The governed
   Criteria and ordered Immediate actions remain visible, text-first, and are
   never replaced by a document image.
2. When an approved `image/png` or `image/jpeg` rendition is available, show
   it as the primary visual in a labelled **Document preview** region. Include
   its document code, source revision, current validation state, and
   `Last checked` beside it. The primary button remains the in-app image
   preview; **Open source document in SharePoint** opens the original in a new
   tab as a secondary action.
3. For a document without an approved image rendition, try a current Graph
   thumbnail only as a non-authoritative orientation image. If none is
   available, show a clear document-type card—e.g. `PDF preview unavailable`
   or `Word document—open source`—rather than an empty or broken frame. The
   Matrix's structured content still answers the urgent operational question.
4. A preview must never be treated as the controlled document itself. Its
   visible caption states the exact document/revision it represents; a preview
   mismatch, stale check, access failure, or missing rendition is conspicuous
   and does not alter Criteria or actions. Whether it blocks publication is a
   governance decision; it must block claiming the preview is current.
5. The image has useful alternative text such as `First-page visual preview of
   SOP-OCC-001 rev 3`; it does not duplicate operational instructions. Keyboard
   focus reaches the preview, its status, and Open source action in a logical
   order. Loading and error states are announced, and no decision-critical
   information exists only in the image.

### Retrieval, authorization, and safety contract

Implement a same-origin **document-preview API** behind the existing
Decision-Matrix read authorization. It resolves only a stored allow-listed
SharePoint `site_id`/`drive_id`/`item_id`, validates the reference revision,
and either streams a safe image response or returns a typed unavailable state.
It must not accept an arbitrary URL from the browser, redirect the browser to
an arbitrary host, or disclose Graph credentials.

Graph's `/content` call responds with a `302` to a preauthenticated,
short-lived download URL. Microsoft specifically notes that browser JavaScript
cannot call `/content` with an Authorization header because CORS preflight and
the redirect conflict ([download driveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)). Therefore the API—not the React client—should obtain content or thumbnail bytes and serve a
same-origin image with restrictive response headers. Do not persist, log, or
put Graph thumbnail, download, or preview URLs into the Matrix record; they
are temporary and can change when the item changes.

Choose and document one authorization model before build:

- **Delegated/OBO** preserves each staff member's SharePoint access when
  rendering and opening a document. The Functions app already has an
  `OnBehalfOfCredential` pattern for Graph, though not for files
  ([`accessManagement.ts`](../functions-restapi/src/functions/accessManagement.ts#L1-L45)).
- **Restricted app identity** is suitable only if product policy says every
  Matrix reader may see the approved rendition. Grant read access narrowly to
  the chosen SharePoint site/item rather than tenant-wide file access;
  `Sites.Selected` permits a subset of site collections
  ([Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference)).

In both cases, never place an app secret or app-only credential in the
browser. The source-document link should use the item `webUrl` and clearly
say when SharePoint may require separate user access. Thumbnail URLs are
cache-safe only while current and change when the item needs a new thumbnail;
the service must re-resolve them rather than treating them as durable assets
([Graph thumbnail retrieval](https://learn.microsoft.com/en-us/graph/api/driveitem-list-thumbnails?view=graph-rest-1.0)).

### Required document-reference fields

Each immutable Procedure Revision should carry one or more document-reference
records with the following data; a rendered preview is derived state, not
canonical Matrix content.

| Group | Fields |
| --- | --- |
| Identity | `reference_id`, `site_id`, `drive_id`, `item_id`, `document_code`, `document_type`, and the user-facing `web_url`. A path may be retained for diagnosis, never as the identifier. |
| Expected controlled document | `expected_revision`, `expected_file_name`, `expected_mime_type`, optional approved content hash, required/optional flag, and the Procedure Revision ID. |
| Observed validation | `observed_etag`, `observed_c_tag` when available, `observed_last_modified_at`, `observed_mime_type`, `observed_size_bytes`, `checked_at`, status, and a non-sensitive failure category. |
| Preview policy | `preview_mode` (`approved_image`, `graph_thumbnail`, or `none`), separate rendition `drive_id`/`item_id` when it is an approved PNG/JPEG, rendition alt text/caption, observed rendition ETag, and preview-checked time/status. |
| Audit/security | validation actor/service, correlation ID, authorization mode, and no stored Graph download, thumbnail, or embed URL. |

### Acceptance criteria for the implementation spec

- An approved PNG/JPEG rendition stored in the referenced SharePoint location
  displays inside the app after an authorized request; its source document
  opens separately in SharePoint and its revision/status are visible.
- The preview endpoint rejects non-Matrix references and arbitrary external
  URLs, enforces the chosen user/service authorization, returns only approved
  image MIME types, and does not expose tokens or temporary Graph URLs.
- PDF, DOCX, XLSX, PPTX, a missing thumbnail, inaccessible SharePoint content,
  a stale/mismatched rendition, and network failure all render an explicit,
  accessible fallback with the original document action when allowed—never a
  blank iframe or an unlabelled broken image.
- A Graph thumbnail can improve orientation but cannot satisfy an
  `approved_image` requirement. Its changed or absent state cannot mutate the
  Procedure Revision, Criteria, or Immediate actions.
- Screen-reader, keyboard, narrow-viewport, loading, image-error, source-link
  authorization, and CSP tests cover the full ladder. A tenant-backed spike
  verifies the selected SharePoint library and all claimed file types before
  Office/PDF embedding is included in scope.
