# Contractor Performance Assessment Functions — Evaluation and Reference

**Evaluated:** September 8, 2026 (supersedes the August 14, 2026 evaluation)
**Scope:** Azure Functions, scoring/report modules, SQL dependencies, authorization, tests, and console integration
**Design reference:** `plans/ContractorPerformanceAssessment_Design.md`

> **Revision note.** The August 14 version was written against the tree *before* commit `60e2de1` (the governed-workflow commit that shipped it) and was never re-run afterwards. Twelve further commits touched the assessment code between August 14 and September 8 (PRs #199–#234, migrations 102 and 110). Roughly half of the August findings are now resolved; this revision re-verifies every finding against the current tree and marks each **Open**, **Partially resolved**, or **Resolved**.

## Executive assessment

The Performance Assessment implementation is a **governed, manually operated monthly workflow** with evidence, validation-draft sharing, exceptions, disputes, credits, and CAP creation wired end to end from handler to console. The remaining gaps are concentrated in three places: automated candidate attribution, report generation concurrency/lineage, and audit breadth.

- 31 HTTP handlers and 1 timer are registered across `assessmentPeriods`, `periodAssessments`, `assessmentReports`, `assessmentGovernance`, `assessmentEvidence`, `complianceOccurrences`, `manualMetrics`, `contractors`, and `performanceStandards`.
- The REST API suite passes: **730 tests, 725 pass, 5 skipped, 0 fail** (`npm test` in `functions-restapi`, 2026-09-08).
- Assessment computation is contractor-scoped and agreement-scoped (migration 102); standards carry a category (migration 110).
- Standards administration, evidence upload, disputes, credits, and CAP persistence — all listed as *Missing* on August 14 — now exist.
- **The one Critical finding is unchanged:** the daily candidate timer still attributes every candidate to `TOP 1` active contractor and does not fail closed when more than one is active.

The module can support a single-contractor pilot today. It should not run with two active contractors until candidate attribution is deterministic, and report replacement lineage should be tightened before a Final Assessment is ever superseded in production.

## Runtime inventory

| Module | Interface | Authorization | Status |
|---|---|---|---|
| Contractor registry | `GET /api/contractors` | Compliance read | Operational |
| Contractor upsert | `PUT /api/contractors/{id}` | Admin | Operational; validation gaps |
| Standards catalog | `GET /api/performance-standards` | Compliance read | Operational |
| Standards administration | `PUT /api/performance-standards/{id}`, `PUT …/{id}/tiers`, `DELETE …/{id}` | Admin | Operational (new since Aug 14) |
| Assessment periods | `GET`, `POST /api/assessment-periods` | Read / write | Operational; open checks agreement window |
| Period computation | `POST /api/assessment-periods/{id}/compute` | Compliance write | Operational; contractor-scoped |
| Period finalization | `POST /api/assessment-periods/{id}/finalize` | Compliance manager | Operational; requires `in_validation` + elapsed window |
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
| Report generation | `POST /api/assessment-reports` | Write (preliminary) / manager (final) | Operational; lineage + concurrency gaps |
| Report preview / download | `GET /api/assessment-reports/{id}/html`, `…/download` | Compliance read | Operational; hash-verified |
| Report issuance | `POST /api/assessment-reports/{id}/issue` | Compliance manager | Operational; creates CAPs, supersedes open disputes |
| Candidate ingestion | `complianceCandidatesPoll`, daily 06:20 UTC | Timer | **Operational; assumes one active contractor** |

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

**Unchanged limitation** (`complianceCandidatesPoll.ts:281`): every candidate is assigned to `SELECT TOP 1 id FROM Contractors WHERE is_active=1 ORDER BY updated_at DESC`. It throws only when there are zero active contractors or no active `PerformanceAgreement` for the chosen one. There is no route, division, or source-to-contractor mapping, and no guard against more than one active contractor.

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
- Finalization requires: `status='in_validation'`, `validation_ends_on` elapsed, `computed_revision=input_revision`, **at least one** KPI row, no row pending or with a mismatched review hash, every `not_assessable` row backed by an `AssessmentExceptions` row, no `candidate` occurrences for the contractor-month, and no row reviewed by the finalizing actor.

### 5. Report generation and issuance

1. Preliminary reports require `in_review`; Final reports require `finalized`.
2. A superseding Final must name the latest Final on the same agreement + month and give a reason.
3. Version is `MAX(version)+1`; the HTML is rendered, hashed, uploaded to private Blob, then the SQL row is inserted.
4. Preview/download re-hash the blob against the stored hash.
5. Issuance re-renders with issuer and a holiday-aware 10-business-day dispute deadline, uploads the issued blob, conditionally stamps the row, writes a `FinalIssuanceRecords` row, marks the period `issued`, supersedes open disputes on the prior Final, creates `CorrectiveActionPlans` for every `cap_required` row, and writes an audit entry. It fails closed when the holiday calendar does not cover the horizon.

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

### Critical — automated candidates use an arbitrary contractor — **OPEN, unchanged**

`complianceCandidatesPoll.ts:281` assigns all imported candidates to `TOP 1` active contractor ordered by `updated_at`. Editing a contractor record silently changes future attribution.

Required correction: define and persist the source-to-contractor rule. Until then, fail closed when `COUNT(*) FROM Contractors WHERE is_active=1` is not exactly one. This is a small SQL change and should land before a second contractor is activated.

### High — report replacement does not enforce the complete reopen cycle — **OPEN**

`assessmentReports.ts:33-35` checks `status='finalized'`, that `supersedes_id` is the latest Final, and that a reason is present. No finalized revision is stored on `ComplianceReports`, so a second Final can be generated from an unchanged finalized state.

Required correction: persist `computed_revision` on each report and require a strictly newer revision (or a `correction_started` audit row after the prior Final) for a superseding Final.

### High — report storage and SQL are not idempotent as one operation — **OPEN**

Version allocation (`MAX(version)+1`), blob upload, and SQL insert remain three unrelated steps. Concurrent generation can raise a unique-key conflict after orphan blobs are written; concurrent issuance can upload an issued blob before the conditional update rejects the loser.

Required correction: reserve the report/version row transactionally before upload; derive the blob path from that row; add orphan-blob reconciliation.

### High — an empty period can finalize — **PARTIALLY RESOLVED**

`assessmentPeriods.ts:116` now requires `EXISTS(SELECT 1 FROM PeriodKpiAssessments WHERE period_id=@id)`, so a zero-row period cannot finalize. The stricter invariant — row count equals the period's scored-standard count — is not enforced, so a period computed against a partial standard set could still finalize.

### High — CAP rules are disconnected from runtime — **RESOLVED (helper still dead)**

`assess.ts` computes and persists `cap_required`; issuance inserts `CorrectiveActionPlans`; `GET /assessment-caps` lists them. The pure `capTriggers` and `consecutiveMonthsBelow` helpers in `escalation.ts` remain referenced only from tests and should be deleted or wired in.

### Resolved — assessment inputs not isolated by contractor — **RESOLVED**

Occurrence, window, threshold, and escalation-history queries all carry `@contractor` (`assess.ts:97-196`).

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
- `complianceCandidatesPoll.test.ts` exists.

### Missing

- Database integration tests for `assessPeriod` against the deployed schema.
- Candidate-ingestion attribution test with two active contractors.
- Finalization test for a partial standard set.
- Report generation/version concurrency and issuance idempotency tests.
- Blob/SQL failure-recovery tests.
- Golden-file coverage for the complete report HTML.
- Handler authorization tests for every role set.
- Authenticated console workflow tests.

## Recommended delivery order

1. **Fail closed on ambiguous contractor attribution** in `complianceCandidatesPoll` (Critical; small change).
2. **Report lineage and idempotency:** persist the finalized revision on reports, reserve the version row before upload, add reconciliation.
3. **Finalization invariant:** require a full scored-standard set.
4. **Audit breadth + read endpoint.**
5. **CAP lifecycle:** status transitions, due-date tracking, console management.
6. **Excusable-delay claims and outages:** handlers to create what `assess.ts` already honours.
7. **Report content:** occurrence schedules, relief detail, CAPs, prior disputes, data sources.
8. **Month-boundary timer:** only after compute, report, and notification paths are proven idempotent.

## Operational readiness statement

The Function App is healthy and the governed workflow — open, compute, review, validation share, evidence, exceptions, finalize, issue, dispute, credit — is exercisable end to end from the console for a **single active contractor**. Automated ingestion is **not safe for multiple active contractors** until candidate attribution is deterministic, and a superseding Final Assessment should not be relied on in production until report lineage is enforced. System outages, excusable-delay claim entry, CAP management, the audit read endpoint, and automatic monthly opening remain unbuilt.
