# Contractor Performance Assessment Functions — Evaluation and Reference

**Evaluated:** September 8, 2026 (supersedes the August 14, 2026 evaluation); **updated September 9, 2026** after PRs #237 and #238 merged and deployed to dev
**Scope:** Azure Functions, scoring/report modules, SQL dependencies, authorization, tests, and console integration
**Design reference:** `plans/ContractorPerformanceAssessment_Design.md`

> **Revision note.** A parallel September 8 review (written in Codex, never committed) found eleven further defects; they are folded in below, each re-verified against `origin/main`, and marked *(from the parallel review)*. The August 14 version was written against the tree *before* commit `60e2de1` (the governed-workflow commit that shipped it) and was never re-run afterwards. Twelve further commits touched the assessment code between August 14 and September 8 (PRs #199–#234, migrations 102 and 110). Roughly half of the August findings are now resolved; this revision re-verifies every finding against the current tree and marks each **Open**, **Partially resolved**, or **Resolved**.

## Executive assessment

The Performance Assessment implementation is a **governed, manually operated monthly workflow** with evidence, validation-draft sharing, exceptions, disputes, credits, and CAP creation wired end to end from handler to console. The remaining gaps are concentrated in three places: automated candidate attribution, report generation concurrency/lineage, and audit breadth.

- 31 HTTP handlers and 1 timer are registered across `assessmentPeriods`, `periodAssessments`, `assessmentReports`, `assessmentGovernance`, `assessmentEvidence`, `complianceOccurrences`, `manualMetrics`, `contractors`, and `performanceStandards`.
- The REST API suite passes: **730 tests, 725 pass, 5 skipped, 0 fail** (`npm test` in `functions-restapi`, 2026-09-08).
- Assessment computation is contractor-scoped and agreement-scoped (migration 102); standards carry a category (migration 110).
- Standards administration, evidence upload, disputes, credits, and CAP persistence — all listed as *Missing* on August 14 — now exist.
- **The Critical finding and both High report findings are closed** (PR #237 v1.5.160; PR #238 v1.5.161, ADR 0029, migration 111 — all live on dev 2026-09-09). Remaining work is governance breadth, not correctness: audit coverage, CAP lifecycle, outage/claim intake, report sections, and the month-boundary timer.

The module can support a single-contractor pilot today. With two active contractors the candidate timer now refuses to run rather than guessing; a source-to-contractor rule is still needed before a second Agreement is activated.

## Runtime inventory

| Module | Interface | Authorization | Status |
|---|---|---|---|
| Contractor registry | `GET /api/contractors` | Compliance read | Operational |
| Contractor upsert | `PUT /api/contractors/{id}` | Admin | Operational; validation gaps |
| Standards catalog | `GET /api/performance-standards` | Compliance read | Operational |
| Standards administration | `PUT /api/performance-standards/{id}`, `PUT …/{id}/tiers`, `DELETE …/{id}` | Admin | Operational (new since Aug 14) |
| Assessment periods | `GET`, `POST /api/assessment-periods` | Read / write | Operational; open checks agreement window |
| Period computation | `POST /api/assessment-periods/{id}/compute` | Compliance write | Operational; contractor-scoped |
| Period finalization | `POST /api/assessment-periods/{id}/finalize` | Compliance manager | Operational; requires `in_validation` + elapsed window + one Assessment Item per standard in the frozen Rule Set |
| Period reopening | `POST /api/assessment-periods/{id}/reopen` | Compliance manager | Operational; audited |
| Not Assessable exception | `POST /api/assessment-periods/{id}/exceptions` | Compliance manager | Operational; audited (new) |
| Validation Draft share | `POST /api/assessment-periods/{id}/validation-share` | Compliance write | Operational; 5-business-day window (new) |
| KPI results | `GET /api/period-assessments?period_id=` | Compliance read | Operational |
| Manager decision | `PATCH /api/period-assessments/{id}` | Compliance write | Operational |
| Occurrence queue | `GET`, `POST /api/compliance-occurrences` | Read / write | Operational; unbounded list |
| Occurrence review | `PATCH /api/compliance-occurrences/{id}` | Compliance write | Operational |
| Occurrence assessed amount | `PUT /api/compliance-occurrences/{id}/assessed-amount` | Compliance write | Operational (new) |
| Manual metrics | `GET`, `PUT /api/manual-metrics` | Read / write | Operational; unbounded list |
| Evidence list | `GET /api/assessment-evidence?assessment_id=` | Compliance read | Operational (new) |
| Evidence upload URL | `POST /api/assessment-evidence/upload-url` | Compliance write | Operational; SAS to private blob (new) |
| Evidence create | `POST /api/assessment-evidence` | Compliance write | Operational; hash + size verified, bumps `input_revision` (new) |
| CAP list | `GET /api/assessment-caps?period_id=` | Compliance read | Operational (new) |
| Disputes list / create | `GET`, `POST /api/assessment-disputes` | Read / write | Operational (new) |
| Dispute decision | `POST /api/assessment-disputes/{id}/decision` | Compliance manager | Operational; writes `AssessmentCredits` (new) |
| Report history | `GET /api/assessment-reports?period_id=` | Compliance read | Operational |
| Report generation | `POST /api/assessment-reports` | Write (Validation Draft) / manager (Issuance Proof) | Operational; supersession derived from period lineage; per-period lock (ADR 0029) |
| Report preview / download | `GET /api/assessment-reports/{id}/html`, `…/download` | Compliance read | Operational; hash-verified |
| Report issuance | `POST /api/assessment-reports/{id}/issue` | Compliance manager | Operational; requires a live Issuance Proof; keeps the proof's hash beside the issued one; creates CAPs, supersedes open disputes |
| Candidate ingestion | `complianceCandidatesPoll`, daily 06:20 UTC | Timer | Operational; fails closed unless exactly one contractor is active (PR #237) |

## Authorization model

All HTTP registrations use `authLevel: "anonymous"`; authorization is enforced inside each handler through `requireRole` (`functions-restapi/src/lib/auth.ts:82-84`).

| Capability | Role set | Roles |
|---|---|---|
| Read assessment information | `COMPLIANCE_READ_ROLES` | staff read roles + `OCC.Compliance`, `OCC.ComplianceManager` |
| Open/compute periods, maintain occurrences, metrics, evidence, disputes; share Validation Drafts; generate preliminary reports | `COMPLIANCE_WRITE_ROLES` | publish roles + `OCC.Compliance`, `OCC.ComplianceManager` |
| Finalize/reopen, authorize exceptions, decide disputes, generate and issue Final Assessments | `COMPLIANCE_MANAGER_ROLES` | `OCC.ComplianceManager` + admin roles |
| Maintain contractors and standards | `ADMIN_ROLES` | admin roles |

Separation of duties: finalization is refused when any KPI row was reviewed by the finalizing actor (`reviewed_by=@actor`).

`System.Ingestion` still inherits `COMPLIANCE_WRITE_ROLES` through `PUBLISH_ROLES`. Confirm that a message-ingestion principal is intended to open periods, compute, upload evidence, and file disputes.

## Processing model

### 1. Candidate ingestion

`complianceCandidatesPoll.ts` runs daily and idempotently merges confirmed missed trips and Late Relief / Expired Pullout departures into `ComplianceOccurrences` as `review_status='candidate'`, `attribution='undetermined'`. Nothing is penalised until staff confirm attribution.

**Attribution** (`assessmentContractorSql()` in `complianceCandidatesPoll.ts`): the poll runs only while exactly one contractor is active — `THROW 50001` with none, `THROW 50003` with more than one (PR #237). There is still no route, division, or source-to-contractor mapping; that rule is what a second Agreement needs before it is activated.

### 2. Period opening

Opening an Assessment Period requires an active contractor with an active `PerformanceAgreement` whose `starts_on..ends_on` covers the first of the service month. One `AssessmentPeriods` row exists per contractor and month; opening an existing pair returns it. Ramp-up is **not** represented or applied (ADR 0007); the legacy `ramp_up_stage` column has no operational effect. Standards and tiers are snapshotted into `AssessmentPeriodStandards` / `AssessmentPeriodTiers` so later catalog edits do not change a period's rule set.

There is still no month-boundary timer; periods are opened manually.

### 3. Computation

`assessPeriod(tx, periodId)` (`functions-restapi/src/lib/assessment/assess.ts:54`):

1. Locks the period; rejects direct recomputation of a finalized period.
2. Loads the period's frozen standards and tiers.
3. Resolves occurrence- or threshold-based inputs **scoped to `period.contractor_id`**, excluding occurrences whose `relief_id` points at an approved `ExcusableDelayClaims` row and recording raw vs. excluded quantities.
4. Matches a tier using direction, band scope (`per_occurrence` / `running_count`), and qualifier; computes the penalty, the escalation multiplier from the Escalation Streak, and `cap_required` from the matched tier's `triggers_cap` and CAP-window rules. There is no ramp-up multiplier (ADR 0007).
5. Canonicalises and hashes the computation input.
6. Upserts one `PeriodKpiAssessments` row per standard, preserving a manager decision only when `input_sha256` is unchanged.
7. Marks the period `in_review` and records the computed revision.

### 4. Review, validation, and finalization

- Manager decision (`PATCH /period-assessments/{id}`) succeeds only while the period is `in_review` and revisions match.
- Validation share moves the period to `in_validation` and sets `validation_ends_on` five business days out (holiday-aware).
- Evidence upload or a new occurrence bumps `input_revision` and drops the period to `stale`, voiding the share.
- Finalization requires: `status='in_validation'`, `validation_ends_on` elapsed, `computed_revision=input_revision`, **one KPI row per standard in the period's frozen Rule Set (and at least one)**, no row pending or with a mismatched review hash, every `not_assessable` row backed by an `AssessmentExceptions` row, no `candidate` occurrences for the contractor-month, and no row reviewed by the finalizing actor. Finalizing also voids any live Issuance Proof, which by construction was rendered from an earlier finalized state.

### 5. Report generation and issuance

1. Validation Drafts require `in_review` and are freely regenerable. An **Issuance Proof** (a `final` row with no `issued_at`) requires `finalized`; at most one is live per period, and preparing another voids the prior one (`voided_at`, audited, nothing deleted). Any Material Assessment Change — evidence or an Assessment Exception on the finalized month, a reopen, or a later finalization — voids it too.
2. Which Final a proof will supersede is derived from the period (`lib/assessment/reportLineage.ts`): a correction period (`supersedes_period_id` set) supersedes the latest *issued* Final of the period it corrects and needs a `supersede_reason`; any other period refuses one. The client's `supersedes_id` is ignored.
3. Generate and issue run under a per-period application lock (`withPeriodReportLock`), so version allocation, blob upload, and the SQL write are serialised. Version numbers count renders per artifact type; voided proofs keep theirs.
4. Preview/download re-hash the blob against the stored hash.
5. Issuance requires a live proof and an issuer who reviewed no item; it re-renders with issuer and a holiday-aware 10-business-day dispute deadline, uploads the issued blob, moves the proof's path and hash to `proof_blob_path` / `proof_sha256`, stamps the row, writes `FinalIssuanceRecords`, marks the period `issued`, supersedes open disputes on the prior Final, creates `CorrectiveActionPlans` for every `cap_required` row, and writes an audit entry. It fails closed when the holiday calendar does not cover the horizon.

### 6. Disputes and credits

Disputes are item-scoped, must be filed before `dispute_deadline_at`, and move through `submitted → under_review → (upheld | adjusted | rescinded | denied)`. `adjusted` and `rescinded` decisions require a credit amount and write `AssessmentCredits`.

## Design coverage

| Designed capability | Aug 14 | Sep 8 | Notes |
|---|---|---|---|
| Contractor maintenance | Partial | Partial | Validation gaps remain (see findings). |
| Standards and tiers catalog | Partial | **Implemented** | Admin PUT/DELETE and tier editing, agreement- and category-scoped (migrations 102, 110). |
| Open/list/compute/finalize/reopen | Implemented | Implemented | Automatic monthly opening still missing. |
| KPI scorecard | Implemented | Implemented | `target_display` now real; `variance_pct` still unpopulated. |
| KPI drill-through handler | Missing | Missing | Console still derives from the global occurrence list. |
| Occurrence candidate review | Partial | Implemented | Review, assessed-amount, and console entry exist. |
| Manual monthly metrics | Implemented | Implemented | Isolation defect resolved. |
| Compliance evidence | Missing | **Implemented** | SAS upload, hash/size verification, versioning, visibility, audit. |
| Not Assessable exceptions | — | **Implemented** | Manager-authorised, audited. |
| Validation Draft sharing | — | **Implemented** | 5-business-day clock, attestation, voided on new input. |
| System outages | Missing | Missing | Table only. |
| Excusable-delay claims | Missing | **Read-only** | `assess.ts` honours approved claims; nothing creates them. |
| CAP lifecycle | Missing | **Partial** | `cap_required` persisted; CAPs created on issuance; list endpoint. No status transitions, due-date tracking, or console management. |
| Penalty disputes | Missing | **Implemented** | List/create/decide with credits and deadline enforcement. |
| Assessment audit query | Missing | Missing | Writes exist for 5 actions; no read endpoint. |
| Report handlers + console | Partial / Missing | **Implemented** | Console generates, previews, issues, and shares. |
| Power BI views | Migration 031 | Migration 031 + PR #217 raw views | Gateway/login outside this evaluation. |

## Findings

### Critical — automated candidates use an arbitrary contractor — **RESOLVED** (PR #237, v1.5.160, 2026-09-09)

`complianceCandidatesPoll` now runs only while exactly one contractor is active (`THROW 50003` otherwise), so editing a contractor record can no longer move the next morning's candidates. A source-to-contractor rule remains future work, gated on a second Agreement actually existing.

### High — report replacement does not enforce the complete reopen cycle — **RESOLVED** (PR #238, ADR 0029, migration 111, 2026-09-09)

Reopening an *issued* period already created a new period row (`supersedes_period_id`, `assessment_revision + 1`); the real hole was that a generated-but-unissued "final" was treated as a supersession target. That render is now an Issuance Proof, never a target; supersession is derived from `supersedes_period_id` and requires a reason on a correction period only.

### High — report storage and SQL are not idempotent as one operation — **RESOLVED** (PR #238)

`withPeriodReportLock` (an exclusive `sp_getapplock` per period for the transaction) serialises generate and issue, so two clicks cannot allocate one version or collide on `UQ_CR_Version` after both blobs were written. A process that dies between upload and INSERT still leaves a blob nothing points at — harmless and never served — which is the accepted residue rather than a cleanup timer.

### High — an empty period can finalize — **RESOLVED** (PR #238)

Finalize requires `COUNT(PeriodKpiAssessments) = COUNT(AssessmentPeriodStandards)` and at least one row. A standard assigned to the Agreement after the period opened waits for the next period (ADR 0006); the in-memory workflow seam snapshots the Rule Set at open and has a test for that case.

### High — CAP rules are disconnected from runtime — **RESOLVED (helper still dead)**

`assess.ts` computes and persists `cap_required`; issuance inserts `CorrectiveActionPlans`; `GET /assessment-caps` lists them. The pure `capTriggers` and `consecutiveMonthsBelow` helpers in `escalation.ts` remain referenced only from tests and should be deleted or wired in.

### Resolved — assessment inputs not isolated by contractor — **RESOLVED**

Occurrence, window, threshold, and escalation-history queries all carry `@contractor` (`assess.ts:97-196`).

### High — the Escalation Streak counts unissued and superseded periods — **OPEN** *(from the parallel review)*

`assess.ts:190-196` selects every prior `PeriodKpiAssessments` row for the contractor and standard where the period is `finalized` **or** `issued`, with no Agreement filter and no latest-revision selection. Two consequences: a corrected month has two period rows (the issued original and its correction, `supersedes_period_id`), so it counts twice; and a month that is finalized but never issued advances the streak, which ADR 0011 says must pause instead. Select one effective *issued* outcome per Agreement and month (the latest `assessment_revision`), and test correction, supersession, Not Assessable pauses, and an Agreement change.

### High — the Validation Draft does not show the amounts that become binding — **OPEN** *(from the parallel review)*

`readModel` in `assessmentReports.ts` renders a Validation Draft from `proposed_total` and the legacy `manager_*` columns, while review writes `recommended_*` (`periodAssessments.ts`) and finalization binds those (`assessmentPeriods.ts`). A waived or adjusted charge can therefore differ between the shared draft and the Final without a new Validation Window — the exact thing ADR 0009 exists to prevent. Render the reviewed recommendation and reason, and bind the share to that revision's hash.

### High — Assessment Exception writes bypass the editable-period guard — **PARTIALLY RESOLVED** *(from the parallel review)*

`assessmentGovernance.ts` inserts an exception for any `not_assessable` item with no check on period status and without voiding a Shared Validation Draft. PR #238 makes an exception void a live Issuance Proof, so a finalized month can no longer be issued over one silently; but an exception can still land on an `in_validation` or `issued` period, and sharing is not restarted. Restrict writes to editable revisions and invalidate the prior share (ADRs 0009, 0013).

### High — registered evidence stays overwritable under its upload token — **OPEN** *(from the parallel review)*

`blobStorage.ts:103` issues the evidence upload SAS with `cw` (create + write) and `assessmentEvidence.ts` verifies size and SHA-256, then registers the *same path*. Until that SAS expires, its holder can overwrite the bytes the hash was taken from. ADR 0013 requires evidence used by a Shared Validation Draft or Final to be immutable: copy verified content to a path the upload token cannot reach (or enable blob immutability), and test a second write after registration.

### Medium — report arithmetic conflates computation with the binding adjustment — **OPEN** *(from the parallel review)*

`renderAssessmentReport.ts:12` prints `(base − relief) × escalation = assessed`, but on a Final `assessed` is the reviewed binding amount, so after a waiver or adjustment the printed equation is false. Show the computed amount, the adjustment or waiver with its reason, and the binding amount as separate lines (design §9 section 5 and 9), and add the occurrence, exception, and CAP schedules.

### Console — High — a stale action response can replace the selected period's rows — **OPEN** *(from the parallel review)*

`AssessmentModule.tsx:31` `act()` captures `selected` at call time; after the action and `load()` it fetches that period's rows and stores them unconditionally. Switching months while an action is in flight lets the old response land after the new period's effect and overwrite its rows; the selection effect also keeps the previous `detailId`. Use one cancellable selected-period loader and reconcile the KPI selection on change.

### Console — High — ranged penalties never expose amount entry — **OPEN** *(from the parallel review)*

`GET /compliance-occurrences` returns `o.*` plus names; it does not join the applicable tier's `penalty_amount_min` / `penalty_amount_max`. The console shows **Set amount…** only when both are present, so a ranged-penalty occurrence (migration 107) can never be given an amount from the UI, and compute keeps it in `awaiting_amount_count`. Return the governed bounds and test the real response shape through the UI.

### Console — Medium — review status reads the binding field before binding exists — **OPEN** *(from the parallel review)*

`ScoreTable` and `ManagerReview` display `manager_action`, which finalization sets; review writes `recommended_action`. A completed review looks pending until the month is finalized. Show recommendations during review and binding decisions after.

### Console — Medium — the Report page cannot open the artifact it manages — **OPEN** *(from the parallel review)*

`ReportWorkflow` lists artifacts and offers generate / share / prepare / issue, but no preview or download, although hash-verified `GET …/{id}/html` and `…/download` exist. A reviewer should read the exact bytes before attesting to sharing, and an Issuing Authority the exact Issuance Proof before issuing. (The parallel review's other point here — repeated final generation needing supersession arguments the UI never collected — closed with PR #238.)

### Caveat — the in-memory workflow seam is not the production path *(from the parallel review)*

`lib/performanceAssessmentWorkflow.ts` is referenced only by its own tests; the SQL handlers do not use it. PR #238 leaned on it for the Issuance Proof lifecycle and the finalize invariant, so those rules are asserted twice — once in the model, once by hand in T-SQL — and only the model is tested. It is a specification the handlers are held to by review, not a test of them. Database-backed handler tests remain the missing layer.

### Medium — report contents are incomplete — **OPEN**

`renderAssessmentReport.ts` renders Summary, Performance standard results, Computation detail, Contractor Evidence, and Dispute rights. Occurrence schedules, exclusions/relief detail, CAPs, prior disputes, data sources, and completeness caveats are still absent.

### Medium — scoring fields are placeholders or disconnected — **PARTIALLY RESOLVED**

- `target_display` — resolved; comes from the standard's `target_display`/`target_value`.
- `direction` — resolved; passed to `matchTier`.
- `triggers_cap` — resolved; drives `cap_required`.
- `variance_pct` — still absent from code and schema.
- `relief_amount` — still hard-coded `0`; relief is now expressed through `excluded_*` columns, so the column is vestigial rather than wrong. Drop it or populate it.

### Medium — contractor validation is incomplete — **OPEN**

`contractors.ts`: whitespace-only names pass and are trimmed to empty; `ASSESSMENT_DATE_RE` accepts non-calendar dates (e.g. `20260231`); end-before-start is allowed. Period opening now checks the agreement window, which mitigates the last item downstream.

### Medium — list interfaces are unbounded — **OPEN**

Contractors, periods, occurrences, and manual metrics accept no query filters and return every row to any compliance reader.

### Medium — audit coverage is incomplete — **PARTIALLY RESOLVED**

`ComplianceAssessmentAudit` now receives `reopened` (or `correction_started` when reopening an issued month creates a correction period), `stale_due_to_prior_period_reopen`, `exception_authorized`, `evidence_added`, and `issued`. Compute, manager decision, finalize, occurrence review, metric supersession, dispute decision, report generation, and validation share are still unrecorded, and there is no read endpoint.

## Architecture evaluation

### Deep modules present

- Penalty, tier-matching, escalation, and CAP-window calculation are pure and tested.
- Hashing makes one canonical input the seam for review preservation.
- Business-day and holiday-coverage validation fail closed for both validation and dispute clocks.
- Report byte verification makes the stored hash the integrity seam.
- Evidence create verifies size and SHA-256 server-side before trusting the upload.

### Shallow modules and leaking seams

- `assessPeriod(tx, periodId)` still owns SQL input resolution, calculation, persistence, and lifecycle in one 241-line function behind an `mssql.Transaction`. Its test surface is the orchestration test, not the interface.
- Report generation, version allocation, blob upload, and issuance are still inline in HTTP handlers; the concurrency rules leak across SQL and Blob.
- Governance handlers (`assessmentGovernance.ts`) embed multi-statement T-SQL per handler; lifecycle rules for periods are spread across `assessmentPeriods`, `assessmentGovernance`, `assessmentEvidence`, and `assessmentReports`.

### Recommended deepening

Unchanged from August: extract a **Performance Assessment lifecycle module** whose interface owns open/compute, contractor-scoped input resolution, review preservation, finalization invariants, CAP creation, and report version/issuance state, with HTTP handlers and a future month-boundary timer as adapters. The status machine (`open → in_review → in_validation → finalized → issued`, with `stale`, `reopened`, and correction branches) is now rich enough that it should be one function, not five handlers agreeing by convention.

## Test posture

### Verified (2026-09-08)

- TypeScript build passes.
- `functions-restapi`: 730 tests, 725 pass, 5 skipped, 0 fail.
- Helpers cover tier edges, qualifier precedence, penalty bases, escalation, CAP windows, stable hashes, business-day deadlines, and missing holiday coverage.
- A deterministic orchestration regression verifies all three contractor-scoped query boundaries.
- `complianceCandidatesPoll.test.ts` pins the exactly-one-contractor guard; `reportLineage.test.ts` covers supersession derivation; the workflow seam covers the Issuance Proof lifecycle and the full-Rule-Set finalize invariant.

### Missing

- Database integration tests for `assessPeriod` against the deployed schema.
- Report generation/version concurrency and issuance idempotency tests against a real database (the lock has no test; the lineage decision and the proof lifecycle do).
- Escalation history across correction periods, unissued months, and Agreement changes.
- Draft/Final parity: the shared Validation Draft's amounts equal what finalization binds.
- Evidence: a second write to a registered path after registration must fail.
- Console: delayed responses while switching periods; a ranged-penalty occurrence through the real list response.
- Blob/SQL failure-recovery tests.
- Golden-file coverage for the complete report HTML.
- Handler authorization tests for every role set.
- Authenticated console workflow tests.

## Recommended delivery order

All items of the September 8 list closed on 2026-09-09 through PRs #237, #238, #244, #246, #247, #249–#254 and #257 (see `ContractorPerformanceAssessment_Implementation_Plan.md` for the per-ticket record). What remains:

1. **The Phase B gate** — the dev walkthrough, by a person, after migrations 112b–114 are applied.
2. **Power BI deployment** (design §10): login, Key Vault secret, gateway (owner cost approval), dataset.
3. A source-to-contractor attribution rule, needed only before a second Agreement is activated (the candidate poll refuses to run until then).

## Operational readiness statement

The Function App is healthy and the governed workflow — open, compute, review, validation share, evidence, exceptions, finalize, issue, dispute, credit — is exercisable end to end from the console for a **single active contractor**. Automated ingestion refuses to run with more than one active contractor, so a second Agreement needs a source-to-contractor rule before activation. Superseding Final Assessments are lineage-checked and the Issuance Proof is distinct from the Final (ADR 0029). Passing unit tests do not establish safe end-to-end issuance: the Escalation Streak, Draft/Final parity, exception guarding, and evidence sealing findings above should close before a Final Assessment is issued to a contractor. The lifecycle is now proved on real SQL Server in CI (review → draft → share → finalize → proof → issue, `assessmentLifecycle.db.contract.test.ts`); the dev walkthrough by a person has still not been performed. System outages, excusable-delay claim entry, CAP management, the audit read endpoint, and automatic monthly opening remain unbuilt.
