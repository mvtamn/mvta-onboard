# Contractor Performance Assessment — Design

**Status:** Design only — no code written. Implementation phasing is in §13 so the build can be costed and sequenced separately.
**Sources of record:** `Compliance/Attachment_G_Final_v2.docx`, `Compliance/ContractorPerformanceStandards_v3.xlsx`
**Scope:** the 9 High/Medium priority KPIs, scored monthly, with manager review before any penalty is issued; a monthly contractor report (§9); Power BI scorecard access (§10).
**Author:** design pass, 2026-08-05. Requires MVTA sign-off on §12 before Phase 1 begins.

---

## 1. Context

`Compliance/Attachment_G_Final_v2.docx` is the contract exhibit that defines how MVTA holds its operations contractor accountable: 18 occurrence-based penalties, 8 threshold-based KPIs, monthly assessment cadence, escalation at 3 consecutive months below standard, CAPs, a ramp-up schedule, an excusable-delay provision, a system-outage data protocol, and a formal penalty-dispute process. `Compliance/ContractorPerformanceStandards_v3.xlsx` is MVTA's internal working copy of the same standards, adding the columns that matter operationally: **Priority**, Score Card Status, KPI Responsibility (Team), Assign To, and Data Source.

Neither file is wired to anything. OnBoard today has three compliance modules (OTP Compliance, Missed Trips, Fixed Route Departures) that surface *measurements* but stop short of *assessment* — there is no KPI catalog, no target/threshold/tier table, no period scoring, no penalty computation, no CAP tracking, and no contractor dimension anywhere in the schema. Two code comments record this as deliberate: `otpMonthlyTrend.ts` says "no Attachment G penalty formula exists in this repo to build one from."

Attachment G v2 now supplies that formula. This design defines a **compliance assessment function**: a governed pipeline that takes measurements from the existing compliance modules plus manually logged occurrences, scores each in-scope KPI against its Attachment G target/threshold/tiers for a monthly period, computes a **proposed** penalty, and puts it in front of a manager who reviews, adjusts, waives, or confirms before anything is issued.

**Intended outcome:** the monthly contractor performance assessment moves out of spreadsheets into OnBoard, with every number drillable to the observation that produced it and every manager decision recorded — which is exactly what Attachment G's dispute process demands.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| KPI catalog scope | Seed **all 26** Attachment G standards (18 occurrence-based + 8 threshold-based); only the **9 High/Medium** priority ones are scored in v1 (`is_scored` flag). The other 17 Low/N-A rows sit dormant — no migration needed when Nexus lands. |
| Penalty dollars | Engine computes a **proposed** penalty per Attachment G tiers. Nothing is final until a manager reviews, may adjust or waive with a reason, and signs off — satisfying Attachment G's "penalties will not be assessed based solely on raw system output without a management-level review." |
| OTP standard | **≥85% with tiers** (80–84.9% warning, 75–79.9% = $1,500, <75% = $3,500) per Attachment G v2. The hardcoded 90% in existing code is a defect to correct (§11). |
| KPIs without a feed | **Manual occurrence entry + evidence attachment** from day one, behind the same tables the future Nexus/M5 feeds will write to. |
| Report format | **Server-rendered self-contained HTML is the official artifact of record.** The console previews and downloads the exact archived bytes; the manager attaches that `.html` file in Outlook. Browser Print-to-PDF remains a convenience copy and is explicitly marked non-authoritative because browser PDF output is not byte-stable (§9). |
| Report delivery | **Generate, archive, and stamp an `issued_at`; the manager sends it from Outlook.** The recorded issuance — not the email — is what starts Attachment G's 10-business-day dispute clock (§9). |
| Report stages | **Preliminary then final.** A preliminary report goes out after computation for contractor review; the final issuance starts the dispute clock. Data errors get caught before they become formal disputes (§9). |
| Power BI access | **Read-only reporting views + a `mvta_reporting_ro` login, reached through an on-prem data gateway on a VNet-joined VM; Import mode.** SQL stays private; Import mode also removes the serverless auto-pause problem (§10). |

---

## 3. In-scope KPIs (v1)

Priority from `ContractorPerformanceStandards_v3.xlsx`.

### Occurrence-based

| Standard | Pri | Penalty | Data path in v1 |
|---|---|---|---|
| Missed Trips Fixed Route / Microtransit | High | $1,000 ea; **$2,000** if last trip of service day | **Auto-candidate** from the shared `MonitoredMissedTrips` review queue (`validation_status='confirmed'`): fixed-route evidence originates in `AvailMissedTripsRouteStopDay`; microtransit evidence originates in `SpareMissedTripSource` / `SpareMissedTripSlots` / `SpareMissedTripEvaluations` (migrations 028–029). Promoted by reviewer. |
| Shutdown Vehicle | High | $1,000 / vehicle / day | Manual (M5 not integrated; source "Unknown" per xlsx) |
| Preventable Collisions | High | $500 ea; $1,000 if unreported in time; CAP if >5 in rolling 30 days; damage reimbursement $2,500–$10,000 | Manual (Nexus) |
| Garage Departure Compliance | Medium | $500 ea | **Auto-candidate** from `FixedRouteDepartures.pullout_status` |
| ADA & Title VI Non-Compliance | Medium | $1,000 ea | Manual (Nexus) |
| Incident and Data Reporting | Medium | $500 ea; CAP after 3+ in 30 days | Manual (Nexus) |

### Threshold-based (monthly)

| KPI | Pri | Target | Warning | Tier 1 | Tier 2 | Data path in v1 |
|---|---|---|---|---|---|---|
| On-Time Performance (Fixed Route) | High | ≥85% | 80–84.9% | 75–79.9% = $1,500 flat | <75% = $3,500 flat | **Auto** from `OtpMonthlyRouteStopDay` + approved exclusions (adjusted/official OTP) |
| Operator Conduct Complaints | High | ≤10/mo | 11–12 | 13–15 = $250/occurrence | 16+ = per occurrence + CAP | Manual monthly metric (Nexus) |
| Avg Miles Between Road Calls | Medium | ≥12,000 mi | 11,000–11,999 (CAP warning) | 10,000–10,999 = $2,000 flat | <10,000 = $3,500 flat | Manual monthly metric (M5 report exists; confirm it matches these thresholds) |

Dormant (seeded, `is_scored = 0`): the 17 remaining standards — including all rows the xlsx marks "not a scorecard item" (Uniform Compliance, Road Supervisor Presence, Operator Staffing, Training Records, Roster Submission, Pre/Post Trip, Mechanic Staffing/Training) and the four Fleet/Cleaning threshold KPIs the xlsx marks Status = Completed with Priority N/A.

---

## 4. Architecture

```
  ┌─ CONFIG (admin, versioned) ──────────────────────────────┐
  │ ContractorPerformanceStandards  ← the 26 Attachment G    │
  │ ContractorStandardTiers         ← target/warning/tiers   │
  │ Contractors                     ← contract dates, ramp-up│
  └──────────────────────────────────────────────────────────┘
                            │
  ┌─ MEASUREMENT INPUTS ─────┴───────────────────────────────┐
  │ (a) Resolvers over existing tables → CANDIDATES          │
  │     OtpMonthlyRouteStopDay / MonitoredMissedTrips /      │
  │     AvailMissedTripsRouteStopDay / FixedRouteDepartures  │
  │ (b) ComplianceOccurrences  ← manual entry + promoted     │
  │     candidates, with ComplianceEvidence attachments      │
  │ (c) ManualMetricEntries    ← monthly values w/o a feed   │
  │ (d) Relief inputs: SystemOutageWindows,                  │
  │     ExcusableDelayClaims, existing OTP exclusions        │
  └──────────────────────────────────────────────────────────┘
                            │
  ┌─ ASSESSMENT ENGINE (pure, testable) ─────────────────────┐
  │ lib/assessment/  →  evaluateStandard(inputs, config)     │
  │  tier match → qty → base amount → relief → ramp-up       │
  │  multiplier → escalation (+50%) → CAP triggers           │
  └──────────────────────────────────────────────────────────┘
                            │
  ┌─ GOVERNANCE ─────────────────────────────────────────────┐
  │ PeriodKpiAssessments (proposed → reviewed → final)       │
  │ AssessmentPeriods    (open → in_review → finalized)      │
  │ CorrectiveActionPlans / PenaltyDisputes                  │
  │ ComplianceAssessmentAudit (every decision, append-only)  │
  └──────────────────────────────────────────────────────────┘
                            │
             Scorecard UI + drill-through to observations
```

**Core principle, carried over from the module's existing governance stance:** automation *proposes*, humans *dispose*. A detected missed trip or late pullout is a **candidate**, not a penalty. It becomes an assessable occurrence only when a reviewer confirms it and attributes it to contractor error — the same pattern as OTP's Review Queue, and the reason `MonitoredMissedTrips.validation_status` already exists.

**Second principle:** one definition, shared. `lib/detourStatus.ts` set the precedent — status is computed in one place "so the API and any future consumer share one definition rather than two drifting ones." The tier-evaluation and adjusted-OTP math live in a shared module consumed by both the API and the console, never reimplemented client-side.

---

## 5. Data model — `migration-030-contractor-performance-assessment.sql`

Follows every convention in `functions-restapi/sql/`: numbered after the current 029 baseline, `GO`-separated batches, long "why" comment headers, `NVARCHAR(200)` for `*_by` actor columns populated from `authResult.principal.userDetails`, single-row config guarded by `CHECK (id = 1)`, and history tables that are never deleted from. Migration numbers 019–029 are already occupied and must not be reused.

### Configuration

**`Contractors`** — the contractor dimension that exists nowhere in the schema today.
`id UNIQUEIDENTIFIER PK`, `name`, `contract_start_date CHAR(8)`, `contract_end_date CHAR(8)`, `is_active BIT`, `updated_by/at`. Drives the ramp-up calculation.

**`ContractorPerformanceStandards`** — the KPI catalog; one row per Attachment G standard.
`id`, `code NVARCHAR(50) UNIQUE` (e.g. `MISSED_TRIPS_FR`, `OTP_FIXED_ROUTE`, `GARAGE_DEPARTURE`), `name`, `description`, `standard_type` CHECK(`occurrence`|`threshold`), `priority` CHECK(`High`|`Medium`|`Low`|`NA`), `is_scored BIT`, `is_safety_critical BIT` (ADA, preventable collisions, unattended riders, unqualified operators — exempt from ramp-up suspension per Attachment G), `direction` CHECK(`higher_is_better`|`lower_is_better`), `unit_label` (`%`, `miles`, `occurrences`, `vehicles`), `measurement_source` CHECK(`auto`|`manual`), `resolver_key NVARCHAR(50) NULL` (names the engine resolver for `auto` rows), `data_source_note`, `responsible_team`, `assigned_to`, `cap_rule_note`, `sort_order`, `effective_start_date/effective_end_date CHAR(8)`, `updated_by/at`.

Seeded from the xlsx: all 26 rows, `is_scored = 1` for the 9 in §3.

**`ContractorStandardTiers`** — the target/threshold/tier bands, so a contract amendment is a data edit, not a code change (Attachment G reserves the right to modify thresholds by amendment).
`id`, `standard_id FK`, `tier_order INT`, `tier_label` CHECK(`meets`|`warning`|`tier1`|`tier2`), `bound_low FLOAT NULL`, `bound_high FLOAT NULL` (half-open `[low, high)`, either side nullable for unbounded), `qualifier_code NVARCHAR(50) NULL`, `penalty_basis` CHECK(`none`|`flat`|`per_unit`|`per_unit_per_day`|`per_day`|`per_week`), `penalty_amount DECIMAL(10,2)`, `triggers_cap BIT`, `notes`, `effective_start_date/end_date`, `updated_by/at`. Unique on `(standard_id, tier_order, effective_start_date)`.

Worked examples:

| Standard | tier_label | bounds | basis | amount | qualifier |
|---|---|---|---|---|---|
| `OTP_FIXED_ROUTE` | meets | `[0.85, –)` | none | 0 | — |
| | warning | `[0.80, 0.85)` | none | 0 | — |
| | tier1 | `[0.75, 0.80)` | flat | 1500 | — |
| | tier2 | `(–, 0.75)` | flat | 3500 | — |
| `MISSED_TRIPS_FR` | tier1 | any | per_unit | 1000 | *(null = default)* |
| | tier2 | any | per_unit | 2000 | `LAST_TRIP_OF_DAY` |
| `OPERATOR_CONDUCT` | meets/warning/tier1/tier2 | `≤10` / `11–12` / `13–15` / `16+` | none/none/per_unit/per_unit | 0/0/250/250 (tier2 `triggers_cap=1`) | — |
| `SHUTDOWN_VEHICLE` | tier1 | any | per_unit_per_day | 1000 | — |

The heterogeneous Attachment G penalty shapes (flat, per-occurrence, per-vehicle-per-day, per-week) all reduce to `basis × amount × quantity`, so **one evaluator handles occurrence and threshold KPIs alike**.

### Measurement inputs

**`ComplianceOccurrences`** — one row per assessable event, whether auto-detected or hand-entered.
`id`, `standard_id FK`, `contractor_id FK`, `service_date CHAR(8)`, `service_month CHAR(6)` (persisted for period rollup), `quantity INT DEFAULT 1`, `duration_days INT NULL` (for per-day bases like Shutdown Vehicle), `qualifier_code NVARCHAR(50) NULL`, `description NVARCHAR(2000)`, `source` CHECK(`auto_candidate`|`manual`), `source_ref NVARCHAR(300) NULL` (natural key of the originating row, e.g. `MonitoredMissedTrips:trip_id|service_date`), `review_status` CHECK(`candidate`|`confirmed`|`dismissed`), `attribution` CHECK(`contractor_error`|`excusable`|`mvta_directed`|`undetermined`), `dismiss_reason`, `relief_id NULL`, `reviewed_by/at`, `created_by/at`.
Filtered unique index on `source_ref WHERE source_ref IS NOT NULL` — a candidate can never be promoted twice by a re-running poller. Indexes on `(service_month, standard_id, review_status)`.

Only `review_status = 'confirmed' AND attribution = 'contractor_error'` rows are counted by the engine. This is where "due to contractor error" — a distinction no existing table records — finally gets captured.

**`ComplianceEvidence`** — attachments backing an occurrence or a manual metric. Mirrors `DetourImages` (migration 017) and reuses its blob container/SAS pattern.
`id`, `occurrence_id NULL FK`, `metric_entry_id NULL FK`, `blob_path`, `content_type`, `file_size_bytes`, `caption`, `uploaded_by/at`. `CHECK` that exactly one parent FK is set.

**`ManualMetricEntries`** — monthly value for a threshold KPI with no feed.
`id`, `standard_id FK`, `contractor_id FK`, `service_month CHAR(6)`, `metric_value FLOAT`, `numerator FLOAT NULL`, `denominator FLOAT NULL`, `unit_count INT NULL` (vehicles/occurrences for per-unit bases), `source_note`, `entered_by/at`, `superseded_by NULL`. Unique on `(standard_id, contractor_id, service_month)` where not superseded — corrections upsert and the audit log keeps the prior value.

**`SystemOutageWindows`** — Attachment G: data generated during a documented outage is excluded from penalty calculation. Garage Departure and ITMS Log-in/out penalties depend on this.
`id`, `system NVARCHAR(50)` (`Avail_CAD_AVL`|`ITMS`|`MDT`|`Other`), `started_at`, `ended_at NULL`, `scope_note`, `logged_by/at`. The engine excludes candidates whose observation timestamp falls inside a window for the relevant system, and reports the count as `diagnostics.excluded_for_outage`.

**`ExcusableDelayClaims`** — the 24-hour written-notice provision.
`id`, `contractor_id FK`, `service_month CHAR(6)`, `event_description`, `event_started_at`, `notice_received_at` (engine flags when > 24h after `event_started_at` — late notice disqualifies relief), `documentation_note`, `status` CHECK(`submitted`|`approved`|`denied`), `decided_by/at`, `decision_note`, `created_by/at`. Approved claims may be linked from `ComplianceOccurrences.relief_id`, or applied at KPI level.

OTP relief already has its own governed mechanism — `OtpStopExclusions` and `OtpDateExclusions` (migration 018). **Do not duplicate it.** The OTP resolver consumes those tables as-is.

### Assessment output & governance

**`AssessmentPeriods`** — one row per contractor-month.
`id`, `contractor_id FK`, `service_month CHAR(6)`, `status` CHECK(`open`|`in_review`|`stale`|`finalized`|`reopened`), `ramp_up_stage` CHECK(`suspended`|`half`|`full`) (computed at open from `contract_start_date`, then frozen), `input_revision INT DEFAULT 0`, `computed_revision INT NULL`, `computed_at`, `proposed_total DECIMAL(12,2)`, `final_total DECIMAL(12,2) NULL`, `finalized_by/at`, `notes`. Unique on `(contractor_id, service_month)`.

Every mutation that can affect a result — occurrence confirmation/attribution, manual metric correction, exclusion, outage or relief decision, tier/config effective for the month, or contractor date change — increments `input_revision` and changes an already-computed non-finalized period to `stale`. A finalized period rejects such mutation until a manager explicitly reopens it. Reopening preserves the prior audit/report history, increments the revision, and requires a new assessment and final report version.

**`PeriodKpiAssessments`** — the assessment function's output: one row per KPI per period. The heart of the scorecard.
`id`, `period_id FK`, `standard_id FK`, `metric_value FLOAT NULL`, `metric_display NVARCHAR(50)`, `occurrence_count INT`, `unit_quantity FLOAT`, `tier_label`, `target_display`, `variance_pct FLOAT NULL` (signed deviation from target; drives the >10% CAP rule), `base_amount DECIMAL(12,2)`, `ramp_up_multiplier DECIMAL(4,2)`, `escalation_multiplier DECIMAL(4,2)`, `relief_amount DECIMAL(12,2)`, `proposed_amount DECIMAL(12,2)`, `input_sha256 CHAR(64)`, `final_amount DECIMAL(12,2) NULL`, `manager_action` CHECK(`pending`|`confirmed`|`adjusted`|`waived`) `DEFAULT 'pending'`, `manager_reason NVARCHAR(1000) NULL`, `reviewed_input_sha256 CHAR(64) NULL`, `cap_required BIT`, `cap_reason NVARCHAR(500) NULL`, `consecutive_months_below INT`, `data_completeness_pct FLOAT NULL`, `computation_json NVARCHAR(MAX)` (the engine's canonical full input snapshot — reproducibility for a dispute and source of `input_sha256`), `reviewed_by/at`. Unique on `(period_id, standard_id)`.

`manager_reason` is **required** whenever `manager_action IN ('adjusted','waived')` — enforced in the validator, not just the CHECK, so the message is legible.

**`CorrectiveActionPlans`** — Attachment G §CAPs.
`id`, `contractor_id FK`, `standard_id NULL FK`, `period_id NULL FK`, `trigger_reason` CHECK(`three_consecutive_months`|`deviation_over_10pct`|`tier_rule`|`rolling_window_rule`|`discretionary`|`contractor_initiated`), `status` CHECK(`required`|`submitted`|`approved`|`in_progress`|`closed`|`failed`), `requested_at`, `due_at` (requested + 5 business days per Attachment G), `submitted_at NULL`, `root_cause NVARCHAR(MAX)`, `corrective_actions NVARCHAR(MAX)`, `responsible_parties`, `timeline_note`, `monitoring_plan`, `closure_criteria`, `closed_at NULL`, `closure_note`, `created_by/at`. The six submission-requirement fields are modeled explicitly so completeness is checkable rather than a blob of prose.

**`PenaltyDisputes`** — Attachment G §Penalty Dispute Process.
`id`, `assessment_id FK → PeriodKpiAssessments`, `contractor_id FK`, `submitted_at`, `notice_deadline_at` (assessment issue + 10 business days; engine flags late submissions as waived-by-default), `basis NVARCHAR(MAX)`, `references_outage_id NULL FK`, `references_claim_id NULL FK`, `completeness` CHECK(`complete`|`returned_incomplete`), `status` CHECK(`submitted`|`under_review`|`upheld`|`reduced`|`waived`|`returned`), `determination_due_at` (receipt + 15 business days), `determination_note`, `adjusted_amount DECIMAL(12,2) NULL`, `decided_by/at`, `created_by/at`.

**`ComplianceAssessmentAudit`** — append-only. Every recompute, promotion, dismissal, manual entry, manager action, CAP transition, and dispute decision.
`id BIGINT IDENTITY`, `entity_type`, `entity_id`, `action`, `actor NVARCHAR(200)`, `before_json NVARCHAR(MAX) NULL`, `after_json NVARCHAR(MAX) NULL`, `note`, `created_at`. Indexed on `(entity_type, entity_id)` and `created_at`. This is what makes an assessment defensible in a dispute; it complements, not replaces, `otpAuditStream`.

**Business-day helper:** Attachment G's 5/10/15-business-day clocks are compliance output, so holiday-aware calculation is a Phase 2 prerequisite to final issuance. `MvtaHolidays` stores the observed MVTA closure dates and effective description; `addBusinessDays(start, count, holidays)` skips weekends and configured holidays and stores the resulting date. Phase 2 cannot enable final report issuance until the holiday calendar covers the entire possible deadline horizon. Missing calendar coverage fails closed with a legible validation error; it never silently falls back to weekdays only.

---

## 6. Assessment engine

New directory `functions-restapi/src/lib/assessment/`, with colocated `*.test.ts` files matching the existing lib convention (`otpMonthlyFeed.test.ts`, `availPullout.test.ts`, `detourStatus.test.ts` all follow it).

| File | Responsibility |
|---|---|
| `tiers.ts` | `matchTier(tiers, value, direction, qualifier)` → the winning tier. Pure. Half-open bounds, unbounded ends, qualifier override. |
| `penalty.ts` | `computePenalty(tier, quantity, durationDays)` → base amount by `penalty_basis`. Pure. |
| `rampUp.ts` | `rampUpStage(contractStartDate, serviceMonth)` → `suspended` (months 1–3) \| `half` (4–6) \| `full` (7+); multiplier `0 / 0.5 / 1.0`, forced to `1.0` when `is_safety_critical`. Pure. |
| `escalation.ts` | `consecutiveMonthsBelow(history, standardId)` and `escalationMultiplier(n)` → `1.5` at n ≥ 3. `capTriggers(assessment)` → the >10%-deviation rule, the tier `triggers_cap` flag, and rolling-window rules (>5 preventable collisions / 30 days; 3+ reporting violations / 30 days). Pure. |
| `resolvers.ts` | One resolver per `resolver_key`, each returning `{ metricValue, quantity, occurrenceCount, dataCompletenessPct, drillThrough[] }`. v1: `OTP_FIXED_ROUTE`, `MISSED_TRIPS_FR`, `GARAGE_DEPARTURE`. `MISSED_TRIPS_FR` reads the shared confirmed `MonitoredMissedTrips` queue and retains `source_system` (`gtfs` or `spare`) in drill-through; it does not independently re-evaluate Spare. Each resolver is a parameterized SQL read; the only DB-touching layer. |
| `candidates.ts` | Detection → `ComplianceOccurrences(source='auto_candidate', review_status='candidate')`, idempotent via `source_ref`. Invoked by a timer poller. |
| `assess.ts` | Orchestrator: `assessPeriod(contractorId, serviceMonth)` → resolve inputs → apply outage/relief exclusions → canonicalize and hash the full input snapshot → `matchTier` → `computePenalty` → ramp-up → escalation → CAP triggers → upsert `PeriodKpiAssessments` + period `proposed_total`. Idempotent when the hash is unchanged. When a KPI's `input_sha256` changes, recompute audits the previous review, resets `manager_action='pending'`, clears `final_amount`, `manager_reason`, `reviewed_by/at`, and `reviewed_input_sha256`, and requires manager re-review. Finalization requires `computed_revision = input_revision`, no `pending` row, and `reviewed_input_sha256 = input_sha256` for every scored KPI. A finalized period still refuses recompute unless explicitly reopened. |
| `otpOfficial.ts` | Adjusted ("official") OTP for a month — the API-side counterpart of the existing frontend `computeOfficialPct` in `otpData.ts`. |

### Ordering (fixed, and asserted by tests)

```
base = penalty(matchTier(value), quantity, durationDays)
after_relief    = base − relief (approved excusable-delay / outage-excluded units)
after_ramp_up   = after_relief × rampUpMultiplier
proposed_amount = after_ramp_up × escalationMultiplier
```

Ramp-up before escalation, both after relief. Attachment G does not state the interaction explicitly; this order is the design's stated assumption and is called out in §12 as a contract-language question for MVTA legal/contract management.

### Reuse, not reinvention

- **`otpData.ts` `computeOfficialPct` / `deriveCandidatesFromLive` / `stopExclusionKey`** — port `computeOfficialPct` into shared code so `otpOfficial.ts` and the console call one implementation. Do **not** write a second adjusted-OTP formula; the CHANGELOG already records one bug from exclusion math getting out of step with `route_label`.
- **`MonitoredMissedTrips.validation_status`** — the missed-trip resolver keys off `'confirmed'`; the existing `POST /api/missed-trips/validate` flow already produces it. No parallel validation UI.
- **`FixedRouteDepartures.pullout_status` + `pullout_delta_seconds`** — the garage-departure resolver reuses the existing derivation in `fixedRouteDepartures.ts` rather than recomputing `DATEDIFF`.
- **`OtpStopExclusions` / `OtpDateExclusions` / `OtpReasonCodes`** — OTP relief in full; the engine reads, never re-implements.
- **`RouteClassification`** — only `route_category = 'FixedRoute'` rows enter Attachment G scoring. `SpecialEvent` is excluded, per `OTP-Feed-Evaluation-and-Recommendation.md`, which is the reason that table exists.
- **`DetourImages` blob/SAS pattern (migration 017 + its handler)** — copied wholesale for `ComplianceEvidence`.
- **`lib/validation.ts`** — new validators (`validateOccurrence`, `validateManualMetric`, `validateManagerAction`, `validateCap`, `validateDispute`) added there, returning `string[]`, with `MAX_*` constants mirroring column widths.
- **`lib/auth.ts` `requireRole`** and **`lib/db.ts` `getPool`** — unchanged.

---

## 7. API surface

New files in `functions-restapi/src/functions/`, one per resource, registered by side-effect import — no infra change needed (`infra-phase1` has no per-endpoint config). Every GET keeps the module's response convention: `{ <rows>, <rollups?>, diagnostics: { configured, table_ready, ...counts } }` with the `OBJECT_ID('dbo.X','U') IS NULL` guard returning `200` + `table_ready: false` so the console never breaks before migration 019 is applied.

| Route | Methods | Purpose |
|---|---|---|
| `/api/performance-standards` | `GET`, `PUT` | KPI catalog + tiers. `PUT` admin-only. |
| `/api/contractors` | `GET`, `PUT` | Contractor + contract dates. `PUT` admin-only. |
| `/api/assessment-periods` | `GET`, `POST` | List/open a contractor-month. |
| `/api/assessment-periods/{id}/compute` | `POST` | Run `assessPeriod` → proposed assessments. |
| `/api/assessment-periods/{id}/finalize` | `POST` | Manager sign-off; requires every scored KPI to be non-`pending`. |
| `/api/period-assessments` | `GET` | Scorecard rows for a period. |
| `/api/period-assessments/{id}` | `PATCH` | Manager action: confirm / adjust (`final_amount`) / waive, with required reason. |
| `/api/period-assessments/{id}/drill-through` | `GET` | Underlying observations behind one KPI number. |
| `/api/compliance-occurrences` | `GET`, `POST` | Candidate queue + manual entry. |
| `/api/compliance-occurrences/{id}` | `PATCH` | Confirm / dismiss / set attribution. |
| `/api/compliance-evidence` | `GET`, `POST`, `DELETE` | Attachments (blob + SAS, per `DetourImages`). |
| `/api/manual-metrics` | `GET`, `PUT` | Monthly value for a no-feed threshold KPI. |
| `/api/system-outages` | `GET`, `POST`, `PATCH` | Documented outage windows. |
| `/api/excusable-delay-claims` | `GET`, `POST`, `PATCH` | Claims + decisions. |
| `/api/corrective-action-plans` | `GET`, `POST`, `PATCH` | CAP lifecycle. |
| `/api/penalty-disputes` | `GET`, `POST`, `PATCH` | Dispute lifecycle. |
| `/api/compliance-assessment-audit` | `GET` | Filterable audit trail. |
| `/api/assessment-reports` (+ `/{id}`, `/{id}/html`, `/{id}/download`, `/{id}/issue`) | `GET`, `POST` | Monthly report generation, verified preview/download, and issuance — detailed in §9. |

**Timer poller** `complianceCandidatesPoll.ts` — daily, following `availMissedTripsPoll.ts`: env-var bail with `context.warn`, per-record try/catch, idempotent `MERGE` on `source_ref`.

Shared-client work: types added to `frontend/packages/shared/src/types.ts`, methods to `frontend/packages/shared/src/api.ts`.

---

## 8. Console UI

A fourth tool in the existing switcher — `frontend/packages/onboard-console/src/routes/Compliance.tsx` gains `{ key: "assessment", label: "Performance Assessment" }` — implemented as `src/routes/modules/assessment/AssessmentModule.tsx` with an internal `NAV` + `PAGE_META` array, exactly like `OtpModule.tsx`. Pure derivations and mock fallback data in `assessmentData.ts`; styles in `assessment.css`.

Conventions carried over verbatim: `useEffect` + `api.*()` with a `cancelled` flag (no react-query), `Promise.all` for parallel loads, `useMemo` for derived rows, the `usingLive = Boolean(d?.diagnostics.table_ready && rows.length > 0)` graceful-degradation check with a `.concept-banner` / `.concept-badge` reading "Live data" or "Preview data", `<table className="data">` + `.pill-sm pill-danger|pill-warning|pill-success|pill-muted`, `.stat-grid` / `.stat-card` KPI cards, and CSS-div bar charts (**no chart library exists in this repo — do not add one**).

| Page | Contents |
|---|---|
| **Scorecard** | Period selector; header stats (Proposed total, Confirmed total, KPIs met / warning / tier 1 / tier 2, CAPs required, ramp-up stage badge); one row per scored KPI: metric, target, variance, tier pill, occurrences, proposed $, manager action state. Row click → drill-through. |
| **KPI Detail** | One KPI: computation breakdown (base → relief → ramp-up → escalation → proposed), consecutive-months-below counter, trend bars, and the observation list behind the number. |
| **Occurrence Log** | Candidate review queue (confirm / dismiss / set attribution, evidence attach) + manual occurrence entry form (`.field-grid` + `.btn-post`). |
| **Monthly Metrics** | Manual metric entry for the no-feed threshold KPIs, with source note and evidence. |
| **Manager Review** | The assessment function's decision surface: per-KPI confirm / adjust / waive with required reason, running total, then **Finalize period** (blocked until nothing is `pending`). |
| **CAPs** | Auto-required CAPs from triggers + manual ones; the six submission fields; due-date and overdue flags. |
| **Report** | Preliminary/final/history selector, sandboxed iframe streaming the archived HTML, official HTML download, convenience Print button, and a manager-gated **Issue** action. Detailed in §9. |
| **Disputes** | Submission intake, completeness check, 10/15-business-day clocks, determination (upheld / reduced / waived) with credit note. |
| **Standards Admin** | Catalog + tier editor (admin only), `is_scored` toggles, effective dates. Read-only for non-admins so anyone can see the governing numbers. |

Also: a `PAGE_META` entry and `NavLink` + icon in `App.tsx` / `components/NavIcons.tsx` if the assessment module is later promoted to its own tab — v1 keeps it inside the Compliance switcher.

---

## 9. Monthly compliance report

One canonical HTML artifact does three jobs: the in-console preview, the `.html` file delivered to the contractor, and the evidence of record if that assessment is later disputed. The preview endpoint streams the archived blob bytes, and Download returns those same bytes with `Content-Disposition: attachment`; both are verified against the stored SHA-256. A browser-created PDF is only a convenience copy and prints **“Convenience PDF — official record is the archived HTML identified on the cover”** in its footer. It is neither archived nor represented as the delivered record.

### Renderer

`functions-restapi/src/lib/report/` — pure, no I/O, fully unit-testable:

| File | Responsibility |
|---|---|
| `buildReportModel.ts` | `(period, assessments, standards, tiers, occurrences, relief, caps, disputes) → ReportModel`. Pure given data; all SQL reads happen in the handler above it. |
| `renderAssessmentReport.ts` | `(model: ReportModel) => string` — one self-contained HTML document: inline `<style>`, no external assets, no scripts, no web fonts. Includes a `@media print` block with `@page { size: letter portrait; margin: 0.6in }`, `break-inside: avoid` on KPI blocks, and repeating `<thead>` on long tables. |

Reuse `escapeHtml()` from `functions-dispatch/src/lib/html.ts` (promote it to a shared location rather than copying it). **Do not add a template engine** — the repo has none, and a report with a fixed section list does not need one.

Because the renderer is a pure string function, it gets golden-file tests: a fixed `ReportModel` in, a snapshot out. That is how a formatting regression gets caught before it reaches a contractor.

### Two issuances

| Type | When | Behavior |
|---|---|---|
| `preliminary` | After compute, before manager sign-off | Watermarked **"PRELIMINARY — FOR CONTRACTOR REVIEW — NOT AN ASSESSMENT"**. No dispute clock. Regenerable freely. |
| `final` | On manager Issue, after the period is finalized | Immutable. Stamps `issued_at` / `issued_by`, computes and prints `dispute_deadline_at`. |

The preliminary stage exists because Attachment G's Data Validation protocol expects the contractor to be monitoring its own Avail/ITMS numbers, and because a data-quality argument is far cheaper to settle before a penalty is formally issued than through the dispute process after.

### Report sections

Ordered to follow Attachment G's own structure, so the contractor can read the two side by side:

1. **Cover** — contractor, service month, issuance type, ramp-up stage, issued date, issued by, report ID and version
2. **Summary** — total assessed, count of KPIs by tier (met / warning / tier 1 / tier 2), CAPs required, prior-period disputes still open
3. **Occurrence-based results** — per standard: confirmed occurrences, rate basis, amount, manager action
4. **Threshold-based results** — per KPI: metric, target, threshold band, tier reached, variance from target, amount
5. **Computation detail, per assessed KPI** — `base → relief → ramp-up × → escalation × → assessed`, plus the consecutive-months-below counter that drives escalation. A contractor must be able to reproduce the arithmetic without asking.
6. **Occurrence schedule** — every counted occurrence: date, description, qualifier, evidence reference. The drill-through, in the document, because a contractor preparing a dispute needs the underlying list and Attachment G requires them to submit supporting documentation against it.
7. **Exclusions and relief applied** — OTP exclusions grouped by reason code, system outage windows excluded, approved excusable-delay claims. Stating what was *removed* in the contractor's favor is as important as stating what was charged.
8. **CAPs required this period** — trigger reason and the 5-business-day submission deadline
9. **Manager notes** — every adjustment and waiver with its recorded reason. Nothing discretionary appears without its justification.
10. **Dispute rights** — the computed 10-business-day deadline, the four required submission elements from Attachment G, and the Contract Manager contact
11. **Data sources and completeness** — which feeds produced each number, data-completeness percentage, and which KPIs were manually entered. The caveats travel with the report rather than living only in someone's head.

### Storage and immutability

**`ComplianceReports`** (add to `migration-030`): `id`, `period_id FK`, `contractor_id FK`, `service_month CHAR(6)`, `issuance_type` CHECK(`preliminary`|`final`), `version INT`, `supersedes_id NULL FK`, `blob_path`, `content_type NVARCHAR(100) DEFAULT 'text/html; charset=utf-8'`, `content_sha256 CHAR(64)`, `assessed_total DECIMAL(12,2)`, `issued_at NULL`, `issued_by NULL`, `dispute_deadline_at NULL`, `supersede_reason NVARCHAR(500) NULL`, `generated_by/at`.

- Blob container `compliance-reports`, reusing `functions-restapi/src/lib/blobStorage.ts` **exactly** — user-delegation SAS via `DefaultAzureCredential`, no account key, 15-minute expiry. New bicep module cloned from `infra-phase1/modules/storage-detour-images.bicep`.
- New env var `COMPLIANCE_REPORTS_STORAGE_ACCOUNT`. **Declare it in `infra-phase1/modules/functionapp.bicep` appSettings** — `DETOUR_IMAGES_STORAGE_ACCOUNT` was not, and per HANDOFF.md pitfall #1 bicep appSettings are full desired state, so a hand-set portal value gets wiped on the next deploy. Do not repeat that.
- `content_sha256` makes "what exactly did we send them?" answerable a year later.
- A final report is written once. Regenerating one for the same period creates a **new version row** with `supersedes_id` and a required `supersede_reason`, and must be explicitly re-issued — a superseded assessment restarts the dispute clock, which is a manager decision, not a side effect of clicking Generate. The API rejects a second final when either field is absent, when `supersedes_id` is not the latest issued final for that period, or when the period was not reopened, recomputed, re-reviewed, and finalized.

### Delivery

Manager clicks **Issue** → the API renders and stores the canonical HTML, verifies its hash, stamps `issued_at` / `issued_by`, computes the holiday-aware `dispute_deadline_at`, writes a `ComplianceAssessmentAudit` row, and returns a same-origin download URL. The manager downloads that `.html` artifact and emails it from Outlook. The console shows issuance history, timestamps, and hashes. Print-to-PDF is offered only as a labeled convenience action.

Automatic ACS email is deliberately out of scope: `functions-dispatch/src/lib/acs.ts` has no attachment support, there is no HTML email template layer, and the dispatch layer only knows opt-in rider `Subscribers` — it has no concept of a contractor distribution list. All three are real work with no compliance benefit, since the recorded `issued_at` is what governs the dispute clock regardless of transport.

### Console page

A **Report** page in the assessment module: issuance selector (preliminary / final / history), the archived HTML in a sandboxed same-origin iframe, a **Download official HTML** action, a Print convenience button calling `iframe.contentWindow.print()`, and an **Issue** action gated to the manager role. The preview response and download response must have the stored `content_sha256`; the UI displays that hash. A period with nothing computed shows the module's `.risk-empty-state`, not a half-rendered report.

### API

| Route | Methods | Notes |
|---|---|---|
| `/api/assessment-reports?period_id=` | `GET` | Issuance history + metadata |
| `/api/assessment-reports` | `POST` | Initial: `{period_id, issuance_type}`. Replacement final: `{period_id, issuance_type:'final', supersedes_id, supersede_reason}`. Renders + stores canonical HTML. `preliminary` is available to publisher/compliance; `final` is manager-only and rejected unless the period is finalized and revision/hash checks pass. A second final requires both supersession fields and the lifecycle checks in Storage and immutability above. |
| `/api/assessment-reports/{id}` | `GET` | Metadata, issuance state, and stored SHA-256; blob access remains behind the verified same-origin endpoints. |
| `/api/assessment-reports/{id}/html` | `GET` | Streams the archived HTML inline for the sandboxed iframe after verifying `content_sha256`; it does not rerender. |
| `/api/assessment-reports/{id}/download` | `GET` | Streams those same verified bytes as `attachment; filename=...html`; this is the official deliverable. |
| `/api/assessment-reports/{id}/issue` | `POST` | Manager-only. Stamps issuance, computes the holiday-aware dispute deadline, audits; fails closed if holiday coverage is incomplete. |

### Month-boundary timer

`assessmentPeriodOpen.ts` — `0 0 6 1 * *` (06:00 UTC on the 1st): open the new period, compute the prior month, generate its preliminary report. It notifies no one and issues nothing; a manager acts. This is the repo's **first month-boundary schedule** — every existing timer is 5-minute, 15-minute, hourly, or daily. `detourImagesPurge.ts` is the closest template (table-existence guard, per-row loop, tolerant error handling). Note the serverless database auto-pauses after 60 minutes, so this job should expect a cold-start wake on its first query.

---

## 10. Power BI scorecard access

**Approach:** read-only SQL views + a dedicated `mvta_reporting_ro` login, reached through an on-premises data gateway on a VNet-joined VM, with Power BI datasets in **Import** mode.

**Why not open SQL to the Power BI service.** Power BI's outbound IP ranges are a large set published in the Azure IP Ranges JSON and revised roughly monthly; firewall rules tracking them are a standing maintenance obligation, and every miss is either a broken refresh or an over-broad rule. The same server also holds subscriber PII, so reversing `publicNetworkAccess: 'Disabled'` costs more than it buys. Power BI Private Link and the managed VNet data gateway would both be cleaner, but both require Fabric/Premium capacity.

**Why Import, not DirectQuery.** The data is monthly-grain and only changes when a manager acts. Import with one or two scheduled refreshes a day means the serverless database wakes twice daily rather than on every visual interaction — which is also the answer to `autoPauseDelay: 60`. Keep auto-pause; schedule the refresh. If DirectQuery is ever genuinely needed, raise `minCapacity` or disable auto-pause as a deliberate, costed decision.

**Upgrade path.** If MVTA moves to Fabric or Premium capacity, replace the gateway VM with a managed VNet data gateway. Same views, same login, no redesign.

### Reporting views — `migration-031-reporting-views.sql`

These are the **first views in the repo** (`grep` finds zero `CREATE VIEW` across `phase1-schema.sql` and migrations 002–030), so the conventions below are worth setting deliberately. Shaped as a small star so Power BI modeling is trivial.

| View | Grain | Contents |
|---|---|---|
| `vw_ScorecardPeriod` | contractor × month | Status, ramp-up stage, proposed/final totals, KPI counts by tier, CAPs required |
| `vw_ScorecardKpi` | contractor × month × standard | **The fact table.** Metric, target, tier, variance, base → relief → multipliers → assessed, manager action, consecutive months below, data completeness |
| `vw_ScorecardOccurrence` | occurrence | Confirmed contractor-error occurrences: date, standard, quantity, qualifier, evidence count |
| `vw_ScorecardStandard` | standard | Dimension: code, name, type, priority, `is_scored`, safety-critical, unit, target display, responsible team, owner |
| `vw_ScorecardTier` | standard × tier | The governing bands — so Power BI draws threshold lines **from data** instead of hardcoded constants that drift from the contract |
| `vw_ScorecardCap` | CAP | Trigger reason, status, requested/due/closed dates, overdue flag |
| `vw_ScorecardDispute` | dispute | Status, outcome, adjusted amount, clock dates |
| `vw_ScorecardTrend` | contractor × month × standard | 24-month rolling series, pre-joined for trend visuals |

View conventions:

- **Finalized periods only by default** — `WHERE status = 'finalized'`. A companion `vw_ScorecardKpi_All` exposes open and in-review periods for internal use. This is the schema-level enforcement of "automation proposes, humans dispose": a Power BI scorecard cannot display a penalty no manager has signed.
- **Convert dates.** The base tables store `service_month CHAR(6)` and `service_date CHAR(8)`; the views emit real `DATE` / `DATETIME2` columns plus a `ServiceMonthStart` date. Without this, Power BI's date table and every time-intelligence measure break — an easy thing to miss and painful to retrofit.
- **Money as `DECIMAL(12,2)`, never `FLOAT`.**
- **Friendly column names** (`AssessedAmount`, not `final_amount`) — these surface directly to Power BI end users.
- **No `SELECT *`.** Explicit column lists, so a base-table change becomes a deliberate view change rather than a silent schema shift in a published dataset.

### Security

- Contained database user `mvta_reporting_ro` with `SELECT` granted **on the `vw_Scorecard*` views only** — never on base tables, and specifically never on `Subscribers`, `ComplianceEvidence.blob_path`, or `ComplianceAssessmentAudit.before_json` / `after_json`.
- Credential stored in Key Vault as `sql-reporting-readonly-connection-string`, mirroring the existing `sql-connection-string` secret pattern in `infra-stage0/modules/sql.bicep`.
- Gateway VM: smallest viable size, in the existing VNet, **no public IP**, administered via Bastion or JIT. New bicep module `infra-phase1/modules/reporting-gateway.bicep`. **Requires owner cost approval** — the same gate the detour-images storage account is currently behind.
- Row-level security is deferred: there is one contractor today. If MVTA ever has two, add a `contractor_id` filter as a SQL RLS predicate or a Power BI role — noted here so it is a known change rather than a discovery.

### Power BI report shape

Built in Power BI by MVTA, not in this codebase: a scorecard page (KPI cards plus a tier-colored matrix), a trend page with target lines sourced from `vw_ScorecardTier`, an occurrence detail page with drill-through from any KPI, a CAP and dispute status page, and a data-completeness page so MVTA and the contractor are looking at the same caveats the report states.

### The invariant that matters

**The Power BI scorecard and the monthly report must agree, always.** Both read `PeriodKpiAssessments`; neither recomputes anything. If a figure differs between them, that is a bug, not a modeling choice — and reconciling the two for the same period is the acceptance test in §14.

---

## 11. RBAC

Follows the per-handler pattern in `lib/auth.ts` (note `OCC.Compliance` is deliberately **not** in any exported role set; it is appended per handler).

| Action | Roles |
|---|---|
| Read scorecards, occurrences, CAPs, disputes, audit | `[...STAFF_READ_ROLES, "OCC.Compliance"]` |
| Log/promote/dismiss occurrences, manual metrics, evidence, outage windows, compute a period | `[...PUBLISH_ROLES, "OCC.Compliance"]` |
| Generate and preview a **preliminary** report | `[...PUBLISH_ROLES, "OCC.Compliance"]` |
| **Manager action (confirm / adjust / waive), finalize a period, issue a final report, supersede an issued report, decide a claim or dispute, approve/close a CAP** | `["OCC.ComplianceManager", ...ADMIN_ROLES]` |
| Edit the standards catalog, tiers, contractor contract dates | `ADMIN_ROLES` |
| Read the reporting views (Power BI) | `mvta_reporting_ro` SQL login — outside the app's role model entirely; no Entra role grants view access, and the app's own identity never uses this login |

**New app role `OCC.ComplianceManager`.** The whole point of this feature is that assessment is a manager act, and `OCC.Compliance` today is an investigator-level grant. This requires an Entra app-role definition and assignment (roles are configured by hand in Entra — `grep` finds no app roles in `infra-*/*.bicep`), plus adding the role to `frontend/.../auth/roles.ts` `AppRole` and to `MVTA_Relay_Admin_UI_RBAC.md`'s capability matrix. Until it is provisioned, `OCC.Admin` alone can sign off, which is a working fallback.

Frontend gating stays visibility-only — `RequireRole.tsx` is explicit that "the API is the real enforcement point."

### Threshold correction to make

`otpMonthly.ts:11` hardcodes `OFFICIAL_OTP_THRESHOLD = 0.9` with the comment "Attachment G's 90% departure-adherence standard," and `otpData.ts` / `otp.css` carry matching `< 90` / `below`-`meets` logic. Attachment G v2 sets **≥85% with tiers**. Correct these to read the target from `ContractorStandardTiers` (falling back to 0.85), rename `diagnostics.routes_below_90` to `routes_below_target`, and update the 90% references in `MVTA_ONBOARD_MANUAL.md` §17. Per manual §19.1 — *"do not allow an AI assistant, vendor, or developer to change an operating threshold or compliance rule solely because it appears technically convenient"* — this change is made because the contract exhibit says so, and it is called out here for explicit MVTA sign-off rather than slipped in.

---

## 12. Open questions for MVTA (documented, not blocking the design)

1. **Missed-trip definition for penalty purposes** — `OTP-Feed-Evaluation-and-Recommendation.md` flags that Avail's `Full Trip Only = 1` (entire trip missed) vs `0` (either end missed) materially changes the count, and "worth confirming against the contract language before hardcoding." Attachment G points to the RFP 2025-07 Glossary. The design stores the choice in `ContractorPerformanceStandards.data_source_note` and the resolver reads it; MVTA must pick. Also confirm `Include Deadheads = 0`.
2. **Multiplier ordering** — does the ramp-up 50% apply before or after the 3-consecutive-month +50% escalation? Design assumes relief → ramp-up → escalation.
3. **Ramp-up month 1** — which month is "Month 1": contract execution or revenue service start? Drives `rampUpStage`.
4. **Complaint aggregation** — Attachment G aggregates multiple complaints about one incident into a single occurrence. Does Nexus already dedupe, or must OnBoard? Affects whether `Operator Conduct Complaints` can ever be auto-fed.
5. **Approval authority split** — the manual records this as unresolved for OTP exclusions (Ops Performance & Compliance Manager vs COO/Transportation Manager). `OCC.ComplianceManager` presumes one tier; a two-tier sign-off would need a second role.
6. **Shutdown Vehicle data source** — the xlsx says "Unknown"; confirm whether M5 tracks it or it belongs in Nexus.
7. **Avg Miles Between Road Calls** — the xlsx says the M5 report already exists; confirm it conforms to the ≥12,000 / 11,000 / 10,000 bands before wiring it.
8. **Microtransit last-trip qualifier** — migrations 028–029 now integrate Spare Requests/Slots, evaluate microtransit candidates, and publish them to the shared `MonitoredMissedTrips` review queue with `source_system='spare'`. Confirm how Attachment G's doubled **last trip of service day** qualifier applies to demand-response service before enabling `LAST_TRIP_OF_DAY` for Spare; until confirmed, Spare candidates use the default $1,000 tier and are never silently classified as last-trip.
9. **Report recipients and Contract Manager contact** — the report's dispute-rights section must print a named MVTA Contract Manager and address. Confirm who, and whether the contractor's receiving distribution list is a single contract contact or a group.
10. **Preliminary report comment window** — how many days does the contractor get to flag data errors on the preliminary report before MVTA issues the final? Attachment G is silent; the design leaves it as a manager judgment unless MVTA sets a standard interval.
11. **Power BI licensing** — does MVTA have Pro only, or Premium/Fabric capacity? Pro confirms the gateway-VM approach; Fabric would let the VM be swapped for a managed VNet data gateway (§10).
12. **Gateway VM cost approval** — needed before Phase 3, the same owner-approval gate the detour-images storage account is behind.

## Not in scope

Nexus/Trackit and Asset Works M5 API integrations; broader Spare ridership/wait-time/garage integration beyond the existing bounded missed-trip Requests/Slots pipeline; automatic report email via ACS (no attachment support in `lib/acs.ts`, no email template layer, no contractor distribution list — and the recorded `issued_at` governs the dispute clock regardless of transport); a contractor-facing portal (Attachment G expects the contractor to monitor its own performance — v1 is MVTA-internal, with contractor access via the existing Entra B2B guest procedure in manual §19.12); row-level security on the reporting views (one contractor today); DirectQuery, Power BI Private Link, and Fabric mirroring (all gated on capacity licensing); invoice/payment withholding; and the recognition/incentive program.

---

## 13. Implementation phasing (for later costing)

| Phase | Content |
|---|---|
| **1 — Foundation** | `migration-030` config + measurement + `PeriodKpiAssessments` + audit tables; revision/hash invalidation and stale-period behavior; seed all 26 standards and the 9 scored tier sets; `lib/assessment/` with `tiers`/`penalty`/`rampUp`/`escalation` + unit tests; the 3 auto resolvers (including both `gtfs` and `spare` records through the shared missed-trip queue); `otpOfficial.ts` shared port; `/api/performance-standards`, `/api/assessment-periods`, `/api/period-assessments`, `/api/compliance-occurrences`, `/api/manual-metrics`; Scorecard + KPI Detail + Occurrence Log + Monthly Metrics pages. Correct the 90% → target-driven threshold. |
| **2 — Governance & the monthly report** | Manager Review + finalize; `ComplianceEvidence` blob upload; `SystemOutageWindows`; `ExcusableDelayClaims`; `CorrectiveActionPlans` + auto-triggers; `MvtaHolidays` + fail-closed holiday-aware business-day helper; `complianceCandidatesPoll`; `OCC.ComplianceManager` role provisioning. **Report:** `lib/report/` renderer + golden-file tests, `ComplianceReports` table, `compliance-reports` blob container and bicep module (with `COMPLIANCE_REPORTS_STORAGE_ACCOUNT` declared in `functionapp.bicep`), the six `/api/assessment-reports*` routes including official HTML download, the console Report page, and the `assessmentPeriodOpen` month-boundary timer. The report depends on finalize and correct deadline calculation, so it belongs here rather than Phase 1. |
| **3 — Power BI, dispute & polish** | `PenaltyDisputes` using the Phase 2 business-day helper; Standards Admin editor; month-over-month trend + data-completeness reporting. **Power BI:** `migration-031-reporting-views.sql` (8 views), the `mvta_reporting_ro` login + Key Vault secret, `reporting-gateway.bicep` VM (owner cost approval required), and the Power BI dataset + report pages built by MVTA. Views depend on finalized periods existing, so Phase 3 is the earliest sensible point. |

---

## 14. Verification

This plan produces a **document**, so verification is review-based:

1. **Coverage check** — every one of the 26 Attachment G standards (18 occurrence + 8 threshold) appears in the design's seed table with the correct priority from the xlsx; the 9 High/Medium ones have complete target/threshold/tier-1/tier-2 mappings. Cross-read the design against `attachG` §Occurrence-Based Penalties and §Threshold-Based Penalties line by line.
2. **Provision coverage** — confirm the design accounts for each narrative provision: assessment frequency, escalation (3 months / >10% deviation), CAP submission requirements and 5-day clock, ramp-up 3 stages with the safety-critical carve-out, excusable delay with 24-hour notice, data validation & outage protocol, dispute process with 10/15-day clocks and three outcomes, complaint aggregation, and criteria definitions.
3. **Reuse check** — confirm no proposed table or function duplicates something that exists: `OtpStopExclusions`/`OtpDateExclusions`/`OtpReasonCodes` (relief), `MonitoredMissedTrips.validation_status` (missed-trip validation), `FixedRouteDepartures.pullout_status` (pullout compliance), `RouteClassification` (fixed-route filter), `DetourImages` (evidence blobs), `computeOfficialPct` (adjusted OTP).
4. **Walkthrough with the KPI owners** named in the xlsx (Rob, Corrina, Cody, Maurice, Michael/Alex) — each in-scope KPI has an owner who should confirm the data path and the manual-entry burden.
5. **Sign-off on the 12 open questions** in §12 and on the 90% → 85% correction before Phase 1 implementation begins.
6. **Report walkthrough** — render one month against real data and read the output as if you were the contractor: is every charged dollar traceable to a listed occurrence, is every waiver justified, is the dispute deadline correct and prominent, and does the completeness statement admit what is manually entered?

Once implementation starts, Phase 1 is verifiable end-to-end by: applying `migration-030` per `HANDOFF.md` §5.7, running `npm test` in `functions-restapi` (the engine is pure and fully unit-testable — tier boundary cases, ramp-up stage edges, escalation at exactly 3 months, each `penalty_basis`, and hash-driven re-review), then `VITE_AUTH_MODE=mock` in the console to compute a real month against live `OtpMonthlyRouteStopDay` / `FixedRouteDepartures` data and confirm the Scorecard's OTP figure equals the OTP module's existing Official OTP % for the same month — a cross-check that immediately catches formula drift. Confirm both `source_system='gtfs'` and `source_system='spare'` confirmed missed trips reach drill-through exactly once.

**Phase 2 (report) acceptance:**
- `npm test` — golden-file snapshot of `renderAssessmentReport` against a fixed `ReportModel`; assert the preliminary watermark is present on `preliminary` and absent on `final`, and that the printed dispute deadline equals `ComplianceReports.dispute_deadline_at`. Test weekend, observed-holiday, year-boundary, and incomplete-calendar cases; incomplete coverage must block final issuance.
- In the console: preview and download a computed month, hash both byte streams, and confirm both equal `ComplianceReports.content_sha256`. Print a convenience PDF and check its non-authoritative footer and Letter pagination — no KPI block split across pages, table headers repeating.
- Issue a final report, then attempt to regenerate it without supersession fields and with a non-latest `supersedes_id`: both must fail. Reopen, recompute, re-review, and finalize; then confirm a new version with the latest `supersedes_id` and explicit `supersede_reason` succeeds, while the original blob remains untouched.
- After manager review, change a counted occurrence or approved exclusion: confirm the period becomes `stale`; recompute must reset affected KPI review to `pending`, and finalization must fail until its `reviewed_input_sha256` matches the new `input_sha256`.
- Recompute the source period after issuance and confirm the issued report's `content_sha256` and totals are unchanged — an issued assessment must not silently move.

**Phase 3 (Power BI) acceptance:**
- Connect as `mvta_reporting_ro` through the gateway: `SELECT` on each `vw_Scorecard*` view succeeds; `SELECT` on `PeriodKpiAssessments`, `Subscribers`, and `ComplianceEvidence` is **denied**.
- Confirm `vw_ScorecardKpi` returns nothing for a period that is `open` or `in_review`, and returns rows the moment it is finalized.
- **The reconciliation test:** for one finalized month, `SUM(AssessedAmount)` from `vw_ScorecardKpi` must equal the total printed on that month's issued report, to the cent. Any difference is a defect in one of the two, not a rounding artifact.
- Trigger a Power BI scheduled refresh against a database that has auto-paused and confirm it succeeds on the cold-start wake rather than timing out.
