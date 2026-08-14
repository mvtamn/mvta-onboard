# Contractor Performance Assessment Functions — Evaluation and Reference

**Evaluated:** August 14, 2026
**Scope:** Azure Functions, scoring/report modules, SQL dependencies, authorization, tests, and console integration  
**Design reference:** `plans/ContractorPerformanceAssessment_Design.md`

## Executive assessment

The Performance Assessment implementation now has an **operational governed monthly workflow foundation**; evidence upload, full CAP/dispute screens, and production migration verification remain rollout work.

- The contractor, period, scoring, manager-review, occurrence, manual-metric, and report handlers compile and are registered.
- The deterministic scoring helpers, revision hashes, stale-review protection, report hashing, and business-day deadline helpers are implemented and tested.
- The REST API suite passes: **278/278 tests**, including a public Performance Assessment workflow seam, contractor isolation, official-artifact formatting, and business-day governance.
- Migration 032 adds Agreement identity, frozen rule-set provenance, Not Assessable exceptions, immutable evidence-version metadata, Validation Draft sharing, Final Issuance Records, Assessment Credits, and item-scoped disputes.
- Assessment computation now scopes occurrences, manual metrics, and escalation history to the selected period's contractor. Automated candidate ingestion still cannot safely choose among multiple active contractors.

The module should not be treated as contract-ready until migration 032 is applied and verified, evidence/CAP/dispute operations are completed, and the governed workflow passes a database-backed acceptance run.

## Runtime inventory

The implementation registers **20 HTTP handlers** and **1 assessment-related timer**.

| Module | Interface | Authorization | Status |
|---|---|---:|---|
| Contractor registry | `GET /api/contractors` | Compliance read | Operational |
| Contractor upsert | `PUT /api/contractors/{id}` | Admin | Operational; validation gaps |
| Standards catalog | `GET /api/performance-standards` | Compliance read | Operational, read-only |
| Assessment periods | `GET`, `POST /api/assessment-periods` | Read / write | Operational |
| Period computation | `POST /api/assessment-periods/{id}/compute` | Compliance write | Operational; isolation defect |
| Period finalization | `POST /api/assessment-periods/{id}/finalize` | Compliance manager | Operational; empty-period defect |
| Period reopening | `POST /api/assessment-periods/{id}/reopen` | Compliance manager | Operational |
| KPI results | `GET /api/period-assessments?period_id=` | Compliance read | Operational |
| Manager decision | `PATCH /api/period-assessments/{id}` | Compliance manager | Operational |
| Occurrence queue | `GET`, `POST /api/compliance-occurrences` | Read / write | Operational |
| Occurrence review | `PATCH /api/compliance-occurrences/{id}` | Compliance write | Operational |
| Manual metrics | `GET`, `PUT /api/manual-metrics` | Read / write | Operational; isolation defect during compute |
| Report history | `GET /api/assessment-reports?period_id=` | Compliance read | Operational |
| Report generation | `POST /api/assessment-reports` | Write / manager | Operational; lifecycle gaps |
| Report preview | `GET /api/assessment-reports/{id}/html` | Compliance read | Operational |
| Report download | `GET /api/assessment-reports/{id}/download` | Compliance read | Operational |
| Report issuance | `POST /api/assessment-reports/{id}/issue` | Compliance manager | Operational; lifecycle gaps |
| Candidate ingestion | `complianceCandidatesPoll`, daily at 06:20 UTC | Timer | Operational; assumes one active contractor |

## Authorization model

All HTTP registrations use Azure Functions `authLevel: "anonymous"`; authorization is enforced inside each handler through `requireRole`.

| Capability | Roles |
|---|---|
| Read assessment information | `OCC.Viewer`, `OCC.Publisher`, `OCC.Admin`, `OCC.Compliance`, `OCC.ComplianceManager` |
| Open/compute periods, maintain occurrences and metrics, generate preliminary reports | `OCC.Publisher`, `OCC.Admin`, `System.Ingestion`, `OCC.Compliance`, `OCC.ComplianceManager` |
| Review/finalize/reopen assessments and issue final reports | `OCC.ComplianceManager`, `OCC.Admin` |
| Maintain contractors | `OCC.Admin` |

`System.Ingestion` inherits assessment write access through `COMPLIANCE_WRITE_ROLES`. Confirm that a message-ingestion principal is intended to open periods, compute assessments, and generate preliminary reports.

## Processing model

### 1. Candidate ingestion

`complianceCandidatesPoll.ts` runs daily and idempotently merges:

- Confirmed missed trips into `MISSED_TRIPS_FR` candidates.
- Late Relief and Expired Pullout records into `GARAGE_DEPARTURE` candidates.
- Each candidate starts as `review_status='candidate'` and `attribution='undetermined'`; it does not affect a penalty until staff confirms contractor attribution.

Current limitation: the timer assigns every candidate to the single most recently updated active contractor using `SELECT TOP 1`. It has no route, division, operating-period, or source-to-contractor mapping.

### 2. Period opening

Opening a contractor-month:

1. Requires an active contractor.
2. Computes and freezes the ramp-up stage from the contractor start date.
3. Inserts one `AssessmentPeriods` row per contractor and service month.
4. Returns the existing period when the pair already exists.

There is no `assessmentPeriodOpen` month-boundary timer. Periods must be opened manually.

### 3. Computation

`assessPeriod(transaction, periodId)`:

1. Locks the period and rejects direct recomputation of a finalized period.
2. Loads all scored standards and effective tier rows.
3. Resolves occurrence-based or threshold-based inputs.
4. Calculates tier, base amount, ramp-up multiplier, escalation multiplier, and proposed amount.
5. Canonicalizes and hashes the computation input.
6. Upserts one `PeriodKpiAssessments` row per scored standard.
7. Preserves a manager decision only when the input hash is unchanged; otherwise resets it to pending.
8. Marks the period `in_review` and records the computed revision.

The pure calculation helpers are individually understandable and tested. The `assessPeriod` interface is still shallow because callers must provide an `mssql.Transaction`, while SQL input resolution, calculation, persistence, and lifecycle transition all remain exposed within one implementation.

### 4. Manager review and finalization

A manager can:

- Confirm the proposed amount.
- Adjust to a non-negative amount with a reason.
- Waive to zero with a reason.

Review succeeds only while the period is `in_review` and the computed revision still matches the input revision. Finalization requires no pending row, matching hashes, and positive data completeness for every existing row.

### 5. Report generation and issuance

The report flow:

1. Builds a report model from the period and KPI results.
2. Renders self-contained HTML.
3. Calculates SHA-256.
4. Uploads the HTML to private Blob Storage.
5. Stores report metadata and hash in SQL.
6. Verifies the downloaded bytes against the stored hash for preview/download.
7. On issuance, re-renders the final report with issuer and a holiday-aware 10-business-day dispute deadline, uploads a new issued blob, conditionally stamps the SQL row, and writes an audit entry.

Final issuance fails closed when the holiday calendar does not cover the deadline horizon.

## Design coverage

| Designed capability | Implementation status | Notes |
|---|---|---|
| Contractor maintenance | Partial | Handler and console form exist; date/name validation is incomplete. |
| Standards and tiers catalog | Partial | Read exists; admin edit does not. |
| Open/list/compute/finalize/reopen periods | Implemented | Automatic monthly opening is missing. |
| KPI scorecard | Implemented | Target display is generic; variance is not populated. |
| KPI drill-through handler | Missing | Console derives occurrences from the global occurrence list instead. |
| Occurrence candidate review | Partial | Review exists; evidence and manual-entry console flow are incomplete. |
| Manual monthly metrics | Implemented | Evidence is missing; scoring isolation defect exists. |
| Compliance evidence | Missing | Table exists; no blob/metadata handlers. |
| System outages | Missing | Table exists; no handlers or scoring relief. |
| Excusable-delay claims | Missing | Table exists; no handlers or scoring relief. |
| CAP lifecycle | Missing | Table and pure trigger helper exist; no handlers, persistence, or automatic creation. |
| Penalty disputes | Missing | Table exists; no handlers or console workflow. |
| Assessment audit query | Missing | Table exists; only reopen and issue write limited entries. |
| Preliminary/final report handlers | Partial | Handlers exist; shared client and console workflow are not connected. |
| Report preview/download/issue console | Missing | Console displays a placeholder panel. |
| Standards administration | Missing | Console is read-only. |
| Power BI views | Implemented in migration 031 | Gateway/login/security deployment is outside this evaluation. |

## Findings

### Resolved — assessment inputs were not isolated by contractor

`assess.ts` resolves data by standard and month but omits the period's contractor from three queries:

1. `ComplianceOccurrences` selects all confirmed contractor-error occurrences for the month.
2. `ManualMetricEntries` selects the latest metric for the month.
3. Prior `PeriodKpiAssessments` history counts any contractor's finalized months for escalation.

Effect: with two active contractors, Contractor A can be charged for Contractor B's occurrences, use Contractor B's manual metric, or inherit Contractor B's escalation multiplier.

Resolution (August 10, 2026): `assessPeriod` now carries `contractor_id` from the locked period and applies it to occurrence, manual-metric, and escalation-history predicates. A deterministic orchestration regression verifies all three query boundaries. A database integration test remains recommended to validate the deployed schema and SQL behavior end to end.

### Critical — automated candidates use an arbitrary contractor

`complianceCandidatesPoll` assigns all imported missed-trip and garage-departure candidates to `TOP 1` active contractor ordered by `updated_at`. Updating a contractor record can silently change future attribution.

Required correction: define and persist the source-to-contractor assignment rule. Until then, fail closed when the number of active contractors is not exactly one.

### High — an empty period can finalize

The finalization condition uses `NOT EXISTS` against incomplete or pending KPI rows. If computation produces zero rows, the condition is true and the period may finalize with a null total.

Required correction: require the number of assessment rows to equal the number of effective scored standards and use `ISNULL(SUM(final_amount),0)` only after that invariant passes.

### High — CAP rules are disconnected from runtime

`capTriggers` is covered by a pure test but is never called in production. `assessPeriod` does not persist `cap_required`, `cap_reason`, or `CorrectiveActionPlans`. The console substitutes `tier2` as a display heuristic.

Deletion test: removing `capTriggers` would not change runtime behavior. The current CAP module is shallow.

### High — report replacement does not enforce the complete reopen cycle

Report generation checks that the period is finalized and that a replacement names the latest final report with a reason. It does not prove that the period was reopened, recomputed, re-reviewed, and finalized after the prior final. A second final version can be generated from the same unchanged finalized state.

Required correction: persist the finalized revision/version on each report and require a strictly newer finalized revision for replacement.

### High — report storage and SQL are not idempotent as one operation

Version allocation uses `MAX(version)+1`, uploads the blob, then inserts SQL metadata. Concurrent generation can create a unique-key conflict after one or more orphan blobs have been written. Concurrent issuance can likewise upload an issued blob before the conditional SQL update rejects the loser.

Required correction: reserve the report/version row transactionally before upload, use a deterministic operation identifier, and add cleanup/reconciliation for abandoned blobs.

### Medium — report contents are incomplete

The renderer includes cover metadata, a summary total, KPI results, computation details, manager action, completeness, and dispute text. The design additionally requires occurrence schedules, exclusions/relief, CAPs, prior disputes, manager notes as a distinct section, data sources, and detailed completeness caveats.

### Medium — scoring fields are placeholders or disconnected

- `target_display` is always `Configured tiers`.
- `variance_pct` is not populated.
- `relief_amount` is always zero.
- Tier `triggers_cap` is loaded but unused.
- `direction` is accepted by `matchTier` but not used; correct results depend entirely on stored tier bands.
- The pure `consecutiveMonthsBelow` helper is tested but not used; similar logic is reimplemented inside `assessPeriod`.

### Medium — contractor validation is incomplete

- A whitespace-only contractor name passes the type check and is trimmed to an empty string.
- Contract start/end values validate digit shape but not real calendar dates.
- End-before-start is allowed.
- Period opening checks active status but not whether the service month falls within contract dates.

### Medium — list interfaces are unbounded

Contractors, periods, occurrences, and manual metrics are returned without pagination or filters. The occurrence and metric handlers return data across all contractors and months to every compliance reader.

### Medium — audit coverage is incomplete

The schema describes an assessment audit, but only period reopen and report issue write entries. Contractor edits, occurrence review, metric supersession, compute, manager decisions, finalize, report generation, and failed governance actions are not recorded.

## Architecture evaluation

### Deep modules already present

- Penalty calculation hides six penalty bases behind one interface.
- Ramp-up calculation hides stage and safety carve-out rules.
- Hashing provides strong leverage: one canonical input determines review preservation or invalidation.
- Business-day calculation and holiday-coverage validation form a useful fail-closed module.
- Report byte verification makes the stored hash the integrity seam for preview and download.

### Shallow modules and leaking seams

- `assessPeriod(transaction, periodId)` requires a database transaction and owns input queries, calculation, persistence, and lifecycle. Its interface does not isolate the scoring policy from the SQL adapter.
- CAP triggering is testable but disconnected from its callers.
- Report generation, persistence, blob upload, version allocation, and issuance are compressed into HTTP handlers; failure and concurrency rules leak across SQL and Blob Storage.
- Console integration exposes many individual shared-client methods while report, dispute, CAP, and evidence workflows are absent.

### Recommended deepening

The first architectural change should be a **Performance Assessment lifecycle module** whose interface owns:

- Opening and computing a contractor-month.
- Resolving contractor-scoped inputs.
- Preserving or invalidating manager review by revision/hash.
- Finalization invariants.
- CAP creation.
- Report generation/version/issuance state.

HTTP handlers and the month-boundary timer should be adapters at that seam. SQL and Blob Storage are real adapters because calculation tests need an in-memory assessment fixture while production needs Azure SQL/Blob behavior. This creates locality for governance rules and leverage across manual actions, scheduled processing, tests, and future contractor access.

Do not add another pass-through module around the existing handlers. Replace the current orchestration with the deep module and make its interface the test surface.

## Test posture

### Verified

- TypeScript build passes.
- Repository test suite: 259 passed, 0 failed.
- Assessment helpers cover tier edges, qualifier precedence, penalty bases, ramp-up, escalation, CAP trigger rules, stable hashes, business-day deadlines, and missing holiday coverage.
- Renderer tests cover preliminary watermarking, HTML escaping, and presence of a final dispute deadline.

### Missing

- Database integration tests for `assessPeriod`.
- Two-contractor isolation tests.
- Handler authorization tests for every role set.
- Period lifecycle and stale-review integration tests.
- Candidate-ingestion attribution tests.
- Empty/incomplete finalization tests.
- Report generation/version concurrency tests.
- Blob/SQL failure-recovery tests.
- Issuance idempotency tests.
- Golden-file or snapshot coverage for the complete report HTML.
- Authenticated console workflow tests.

## Recommended delivery order

1. **Finish multi-contractor protection:** make automated candidate attribution deterministic or fail closed when it is ambiguous. Assessment computation is now contractor-scoped.
2. **Protect finalization:** require a complete scored-standard set and add lifecycle integration tests.
3. **Connect existing report functions:** add shared-client methods and implement report history, preview, download, generation, and issue controls in the console.
4. **Implement governance inputs:** evidence, outages, excusable-delay claims, CAP persistence, and audit writes.
5. **Implement disputes:** completeness, business-day clocks, determinations, and credits.
6. **Implement standards administration:** effective-dated standard/tier changes with audit.
7. **Add the month-boundary timer:** only after computation, report, holiday, and notification failure paths are proven idempotent.

## Operational readiness statement

The Function App is healthy and the implemented interfaces can support a manually operated, single-contractor pilot. It is **not fully operational against the approved design** and automated ingestion is **not safe for multiple active contractors** until candidate attribution is deterministic. Assessment computation itself is now contractor-scoped. Report handlers exist but the console cannot exercise them; CAP, dispute, evidence, outage, claim, audit-query, standards-edit, and automatic monthly workflows remain incomplete.
