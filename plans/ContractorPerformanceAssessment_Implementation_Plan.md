# Contractor Performance Assessment — Implementation Plan

**Built:** September 9, 2026 (status marks added the same day: A–I merged, J and the gate open), from `ContractorPerformanceAssessment_Functions_Evaluation.md` (findings, delivery order) and `ContractorPerformanceAssessment_Design.md` §0 (what was designed, what was built, what remains). Those two are the sources; this file is the work breakdown. When they disagree, fix them, not this.

**Vocabulary:** `CONTEXT.md` § *Contractor performance assessment language*. ADRs 0005–0013, 0028, 0029 bind every ticket below.

## The goal this plan serves

**A Final Assessment can be issued to the contractor and defended in a dispute.** Everything on `main` today runs; four governance defects make an issued Final indefensible, and a handful of console defects make the workflow unusable in practice. The plan closes those first, then the operator-facing gaps, then the automation and reporting that only make sense once the core is trustworthy.

Definition of done for *"ready to issue to a contractor"* — the gate at the end of Phase B:

1. The Escalation Streak is computed from issued outcomes only, one per Agreement-month.
2. The amounts on a Shared Validation Draft are the amounts finalization binds, and the share is tied to that revision's hash.
3. No write can change an Assessment Item after sharing without restarting the Validation Window.
4. Evidence registered against an Assessment Item cannot be altered afterwards.
5. A reviewer can open the exact draft bytes before attesting; an Issuing Authority can open the exact Issuance Proof before issuing.
6. A ranged-penalty occurrence can be given an amount from the console.
7. The dev walkthrough (open → compute → review → share → finalize → prepare proof → issue → reopen → correction → superseding Final) has been performed once, by a person, and the report bytes match their stored hashes.

## How to read a ticket

Each ticket is a **tracer bullet**: one behaviour, end to end, shippable alone. `Blocked by` names the tickets whose merge it needs; anything with no blocker can start now, in parallel. `Seam` is where the test goes (per `/tdd`: tests only at pre-agreed seams). Size is S (≤ ½ day), M (1–2 days), L (3+ days). Migration numbers are the next free ones and follow `functions-restapi/sql/README.md` — suffix a collision, never renumber. No ticket adds an Entra app role.

---

## Phase A — Governance correctness

Nothing in later phases matters if a Final can be wrong in a way the contractor can prove.

### A1 — The Escalation Streak reads one issued outcome per Agreement-month · **M** — **built, #244**

*Finding:* Evaluation § "the Escalation Streak counts unissued and superseded periods" (ADR 0011).
- `assess.ts:190-196`: the history query filters `status IN ('finalized','issued')` with no Agreement scope and no revision selection. Change to: periods of the **same Agreement**, `status='issued'`, and for each `service_month` the row with the highest `assessment_revision` (a correction period supersedes its original). A finalized-but-unissued month contributes nothing and does not break the streak (ADR 0011: it pauses).
- Snapshot the streak inputs into `computation_json` so a dispute can reproduce it.
- **Seam:** the deterministic orchestration harness in `assessment.contractor-isolation.test.ts` (fake `Transaction`) — add cases: correction period after issue counts once; unissued month pauses; Not Assessable pauses; a second Agreement's months are invisible.
- **Migration:** none. **Blocked by:** none.

### A2 — A Shared Validation Draft shows the recommended amounts and binds to their hash · **M** — **built, #244**

*Finding:* Evaluation § "the Validation Draft does not show the amounts that become binding" (ADR 0009).
- `readModel` in `assessmentReports.ts`: for `preliminary`, read `recommended_action`, `recommended_amount`, `recommendation_reason` (falling back to proposed when no review exists yet) — not the legacy `manager_*` columns. Render the reason on the draft.
- `ValidationDraftShares` records the draft's `content_sha256` **and** the period's `computed_revision` + per-item `reviewed_input_sha256` set at share time. Finalize refuses when any of those differ from the current row (today it only checks `computed_revision=input_revision`).
- A `PATCH /period-assessments/{id}` after sharing already drops the period to `stale`? **Verify**; if not, it must (Material Assessment Change).
- **Seam:** `lib/report/buildReportModel`-style pure function extracted from `readModel` (today `readModel` is SQL + mapping in one) with tests: draft shows recommended amount and reason; final shows binding amount. Plus a `migration112.db.contract.test.ts` that shares, patches a review, and expects finalize to refuse.
- **Migration 112:** `ValidationDraftShares.computed_revision INT NULL`, `items_sha256 CHAR(64) NULL` (hash of ordered `reviewed_input_sha256`s). **Blocked by:** none.

### A3 — Assessment Exception writes are guarded and restart sharing · **S** — **built, #244**

*Finding:* Evaluation § "Assessment Exception writes bypass the editable-period guard" — partial after #238.
- `assessmentGovernance.ts` exception insert: refuse unless period `status IN ('in_review','in_validation','stale','reopened','finalized')`; never on `issued` (a correction period exists for that). When status is `in_validation` or `finalized`: bump `input_revision`, set `stale`, `superseded_at` on the open `ValidationDraftShares` row, clear the validation columns — the same block `assessmentEvidence.ts` already runs. Extract that block into `lib/assessment/materialChange.ts` as `materialChangeSql(periodParam, actorParam)` and use it from evidence, exceptions, and (A2) review-after-share.
- **Seam:** `materialChange.test.ts` pins the statuses it touches and that it composes with `voidLiveIssuanceProofSql` (ADR 0029). **Migration:** none. **Blocked by:** none (A2 will call it, not the reverse).

### A4 — Registered evidence is sealed · **M** — **built, #244**

*Finding:* Evaluation § "registered evidence stays overwritable under its upload token" (ADR 0013).
- `assessmentEvidence.ts` create: after verifying size and SHA-256 of the uploaded blob, **copy** it to `sealed/{assessment_id}/{evidence_id}.bin` in the same container using the app's own credential, register **that** path, and verify the copy's hash. The `cw` upload SAS never covers `sealed/`. Delete the staging blob on success (staging is not an artifact; the sealed copy is).
- Reads (`GET /assessment-evidence`, report captions, future download) use the sealed path only.
- Alternative considered: a container-level immutability policy — needs infra and applies to reports too; defer.
- **Seam:** `blobStorage.test.ts` for path derivation (`sealed/` is not a prefix the upload path builder can produce); a contract test that a second write to the registered path is refused is only possible against real storage — document the manual check in the PR.
- **Migration:** none (`blob_path` holds the sealed path). **Blocked by:** none.

### A5 — The report separates computation from the binding adjustment · **S** — **built, #244**

*Finding:* Evaluation § "report arithmetic conflates computation with the binding adjustment".
- `renderAssessmentReport.ts`: per item print *Computed* `base × escalation` (relief is an input exclusion, not a subtraction — ADR 0012; drop `− relief` and show excluded quantities instead), then *Review* action + reason, then *Binding amount*. The equation must be true on every artifact.
- **Seam:** `report.test.ts` golden-file per artifact kind (draft, proof, final) — a waived item prints computed ≠ binding with the reason. **Blocked by:** A2 (model fields).

---

## Phase B — Console correctness

The module has to be usable by the people in §14 of the design before Phase A is worth verifying by hand.

### B1 — One cancellable loader for the selected period · **S** — **built, #246**

*Finding:* Evaluation § "a stale action response can replace the selected period's rows".
- `AssessmentModule.tsx:31` `act()`: stop refetching rows inside `act`; instead bump a `refreshKey` that the existing `[selected]` effect (line 28, already cancellable) depends on. Reset `detailId` when `selected` changes.
- **Seam:** a component test with two in-flight `getPeriodAssessments` promises resolved out of order — the later selection wins. **Blocked by:** none.

### B2 — Ranged penalties expose amount entry · **S** — **built, #246**

*Finding:* Evaluation § "ranged penalties never expose amount entry".
- `GET /compliance-occurrences`: join the standard's current tier where `penalty_amount_min IS NOT NULL` (latest `effective_start_date ≤ service_date`, matching `qualifier_code`) and return `penalty_amount_min/max`. The console already renders **Set amount…** when both are present.
- **Seam:** `validation`-style pure test for the tier pick; a console test through the real response shape (fixture from the handler's SELECT). **Blocked by:** none.

### B3 — Review shows recommendations before binding · **S** — **built, #246**

*Finding:* Evaluation § "review status reads the binding field before binding exists".
- `ScoreTable` / `ManagerReview`: while `status ∈ {in_review, in_validation, stale}` show `recommended_action` + reason; from `finalized` on show `manager_action` / `binding_amount`. Label the column by state ("Recommendation" / "Binding decision").
- **Seam:** component test across the two states. **Blocked by:** none.

### B4 — The Report page opens the artifact it manages · **M** — **built, #246**

*Finding:* Evaluation § "the Report page cannot open the artifact it manages"; design §9 *Console page*.
- Add **Preview** (sandboxed same-origin `<iframe>` streaming `GET …/{id}/html`) and **Download official HTML** (`…/download`) per row; show the row's `content_sha256` and, on an issued Final, `proof_sha256` beside it. Print button calls `iframe.contentWindow.print()` with the non-authoritative footer already in the renderer.
- Record-sharing and Issue actions require that the artifact was opened at least once in this session (a UI nudge, not a server rule).
- **Seam:** component test that a voided proof has no Issue action and a Final has no Prepare; the iframe wiring is verified in the browser. **Blocked by:** none.

### Gate — dev walkthrough · **S, a person** — **open**

Run the definition-of-done walkthrough on dev with an `OCC.ComplianceManager` account and record the result in the Evaluation's *Operational readiness statement*. **Blocked by:** A1–A5, B1–B4 deployed and migration 112 applied.

---

## Phase C — Audit and history

### C1 — Every governance act writes an audit row · **M** — **built, #247**

*Finding:* Evaluation § "audit coverage is incomplete".
- Add `ComplianceAssessmentAudit` writes for: compute (`computed`, with revision and per-item hash summary), manager recommendation (`recommended`, before/after), validation share (`validation_shared`), finalize (`finalized`), dispute create/decide (`dispute_filed`, `dispute_decided`), Validation Draft generation (`draft_generated`). Issuance Proof and issue rows exist since #238. One `lib/assessment/audit.ts` with `auditSql(entity, action, actorParam, afterExpr)` so the shapes stay uniform.
- **Seam:** `audit.test.ts` for the SQL shapes; the workflow seam's `audit()` list extended to match. **Blocked by:** A2 (share hash goes in the row).

### C2 — `GET /api/compliance-assessment-audit` and a History panel · **M** — **built, #247**

- Filter by `period_id` (all entities of that period and its items/reports) or `entity_type + entity_id`; paged; `COMPLIANCE_READ_ROLES`. Console: a **History** tab in the module showing the period's trail newest-first.
- **Blocked by:** C1.

---

## Phase D — Report content

### D1 — Occurrence, exclusion, exception, and CAP schedules · **M** — **built, #249**

Design §9 sections 6, 7, 8, 11. `readModel` gains occurrences (confirmed + contractor-error, with `source_ref` and evidence hashes), exclusions grouped by cause (approved claim / attribution / OTP exclusion reason), the period's `AssessmentExceptions`, CAPs created for the period, and a data-sources block from `AssessmentPeriodStandards.measurement_source` + `data_completeness_pct`. Renderer sections follow the design's order.
- **Seam:** golden-file snapshot; one fixture with every section populated. **Blocked by:** A5.

---

## Phase E — CAP lifecycle

### E1 — CAP transitions and due dates · **M** — **built, #250**

Table has `status IN ('required','submitted','approved','in_progress','closed','failed')` and the six submission fields (design §5). Add `PATCH /assessment-caps/{id}` with a transition map (`required→submitted→approved→in_progress→closed|failed`; manager roles for approve/close/fail), required fields per transition, `overdue = due_at < now AND status='required'`. Console **CAPs** tab gets the transition controls and the six fields.
- **Seam:** pure `capTransitions.ts` with tests; delete the dead `capTriggers`/`consecutiveMonthsBelow` in `escalation.ts` in the same PR. **Blocked by:** none.

---

## Phase F — Relief intake

### F1 — Excusable-delay claims · **M** — **built, #251**

Tables exist; `assess.ts` already excludes occurrences whose `relief_id` points at an approved claim. Add `GET/POST /excusable-delay-claims`, `POST …/{id}/decision` (manager), the 24-hour late-notice flag, and `PATCH /compliance-occurrences/{id}` accepting `relief_id`. A decision on a claim is a Material Assessment Change for its month (A3's fragment). Console: a **Relief** section on the Occurrence Log.
- **Seam:** pure late-notice rule; handler shape through the workflow seam. **Blocked by:** A3.

### F2 — System outage windows · **M** — **built, #251**

`GET/POST/PATCH /system-outages`; `assess.ts` excludes candidates whose observation falls inside a window for the relevant system and reports `excluded_for_outage`. Console: outage entry under Relief.
- **Blocked by:** F1 (shares the Relief UI).

---

## Phase G — Database-backed confidence

### G1 — Lifecycle and concurrency contract tests · **L** — **built, #252 + #257** (drives open → compute → review → draft → share → finalize → proof → issue; reopen → correction → superseding Final is still handler-inline SQL and not driven)

*Finding:* Evaluation § caveat on the model-only seam. The CI contract job already runs SQL Server (`DECISION_MATRIX_TEST_SQL_CONNECTION_STRING`, `api.yml:68`). Add `assessmentLifecycle.db.contract.test.ts`: apply migrations 030–112, seed one Agreement, run open → compute → review → share → finalize → prepare proof → issue → reopen → correction → superseding Final against real SQL, assert hashes, streak (A1), share binding (A2), the `UX_CR_LiveProof` index under two concurrent prepares, and `sp_getapplock` serialisation. Blob calls go to a local fake.
- **Blocked by:** A1, A2, A3.

---

## Phase H — Ownership and lists

### H1 — Manual-metric owners and the month-end open-items list · **M** — **built, #253**

Design §0.3 gap F. `assigned_to` values come from the `assigned_to` reference list (migration 108); map each to the account's user principal name in the list row (migration 113: `ReferenceValues.principal_upn` — a UPN is what an administrator can type and what the signed-in account exposes; an object id is neither, at the cost of a rename breaking the match visibly). `GET /manual-metrics/open?service_month=` returns scored manual standards with no entry for the month, grouped by owner. Console: an **Open inputs** banner on Monthly Metrics for the signed-in owner. No new role.
- **Blocked by:** none.

### H2 — Bounded list queries · **S** — **built, #253**

Evaluation § "list interfaces are unbounded": `contractor_id`, `service_month`, `review_status` filters and `limit/offset` on occurrences, metrics, periods; the console passes the selected period. **Blocked by:** none.

---

## Phase I — Automation

### I1 — Month-boundary timer · **M** — **built, #254**

Design §9 *Month-boundary timer*: `assessmentPeriodOpen` at 06:00 UTC on the 1st opens the new period, computes the prior month, generates its Validation Draft, issues nothing. Idempotent per run; fails closed on the same gates as the handlers. **Blocked by:** G1 (proven idempotent), C1 (audited).

---

## Second pass — follow-ups the reviews deferred (#257)

Outage wording in the report (F); `withdrawn` CAPs and manual determinations, migration 114 (E); finalize/issue as libs so the contract test drives the whole chain (G); these status marks.

## Phase J — Power BI

### J1 — Reporting login, secret, gateway, dataset · **L, infra + owner cost approval**

Design §10: `mvta_reporting_ro` contained user with SELECT on `vw_Scorecard*` and the 106 raw views only; Key Vault `sql-reporting-readonly-connection-string`; `reporting-gateway.bicep` VM (no public IP); dataset built by MVTA. Use `/wizard` for the human steps. Acceptance = the §14 reconciliation test. **Blocked by:** owner cost approval; technically none.

---

## Dependency graph

```
A1 ─┐
A2 ─┼─▶ G1 ─▶ I1
A3 ─┘        ▲
A2 ─▶ A5 ─▶ D1   C1 ─▶ C2
A3 ─▶ F1 ─▶ F2   (C1 needs A2)
B1 B2 B3 B4 E1 H1 H2 J1 — no blockers
Gate (dev walkthrough) needs A1–A5, B1–B4
```

Start now, in parallel: **A1, A2, A3, A4, B1, B2, B3, B4** (eight tickets, no shared files except A2/A3 both touching `assessmentGovernance.ts` — land A3 first). Everything else follows.

## Migrations this plan adds

| # | Ticket | Contents |
|---|---|---|
| 112 | A2 | `ValidationDraftShares.computed_revision`, `items_sha256` |
| 113 | H1 | `ReferenceValues.principal_id` |

Both re-runnable; both added to `scripts/apply-dev-migrations.sh` with a landing check; applying to dev stays an operator step.

## Out of scope, still

Nexus / M5 integrations; ACS email of reports; contractor portal; row-level security on the views; a source-to-contractor attribution rule (needed only when a second Agreement is activated — the poll refuses until then).
