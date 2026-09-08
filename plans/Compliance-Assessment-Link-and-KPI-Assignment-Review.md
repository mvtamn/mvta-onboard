# Compliance → Assessment Links, and KPI Assignment to Contractor

Review date: 2026-09-06. Scope: how the three Compliance modules (OTP, Missed
Trips, Garage Departures) connect to the Performance Assessment module, and what
is actually missing from "KPIs and performance measures assigned to a
contractor" under Attachment G.

## Headline

The Attachment G KPI catalog is **already built** — all 26 standards, the 9
scored ones with full tier bands, penalty bases, escalation, and CAP triggers,
snapshotted per period so a later amendment does not rewrite history. What is
missing is not the catalog. It is (a) any *user-visible* link between the two
modules, and (b) the layer that binds standards **to a contractor's agreement**
rather than to the agency as a whole.

## Part 1 — Link inventory

### Links that exist (backend only)

| Link | Where | Feeds |
|---|---|---|
| Missed trips → occurrences | `functions-restapi/src/functions/complianceCandidatesPoll.ts:288` | `MonitoredMissedTrips` (`validation_status='confirmed'`, both `gtfs` and `spare` sources) → `ComplianceOccurrences` as `MISSED_TRIPS_FR` candidates |
| Fixed-route departures → occurrences | `complianceCandidatesPoll.ts:303` | `FixedRouteDepartures` past the 10-min variance → `GARAGE_DEPARTURE` candidates |
| On-demand departures → occurrences | `complianceCandidatesPoll.ts:320` | `OnDemandDepartures` → `GARAGE_DEPARTURE` candidates |
| OTP → threshold KPI | `functions-restapi/src/lib/assessment/assess.ts:22` (`resolveThreshold`) | `OtpMonthlyRouteStopDay`, filtered to `RouteClassification='FixedRoute'` and net of approved `OtpStopExclusions` |
| Occurrence review → period staleness | `complianceOccurrences.ts` PATCH/POST | bumps `AssessmentPeriods.input_revision` and flips `in_review` → `stale`, so a reviewed change cannot be silently finalized |

That backbone is sound. The exclusion accounting in particular is good: raw vs.
assessable vs. excluded are all carried separately into `PeriodKpiAssessments`,
so the report can show what was left out and why.

### Gaps

**1. There is no navigational link in either direction.**
`routes/Compliance.tsx` is a three-button switcher with no route out;
`AssessmentModule.tsx` contains no `<Link>`, `useNavigate`, or `href` at all.
The only thing joining them is the shared "Compliance & Assessment" nav group in
`App.tsx:305`. A reviewer confirming a missed trip has no way to see it became a
$1,000 occurrence; a manager on KPI Detail cannot jump back to the trip.

**2. `source_ref` is a drill-through key nothing dereferences.**
Occurrences carry a resolvable reference — e.g.
`MonitoredMissedTrips:spare:<id>|<service_date>`,
`FixedRouteDepartures:<id>` — but the Occurrence Log renders it as text. The
design's promise that "every number is drillable to the observation that
produced it" is true in the data and false in the UI.

**3. The Compliance modules show no assessment state.**
No candidate/confirmed/dismissed badge, no period status, no "4 candidates must
be reviewed before August can be finalized" banner — even though an unreviewed
candidate is exactly what blocks finalization. The reviewer has no reason to
visit the queue.

**4. `resolver_key` is dead metadata.**
It is seeded on `MISSED_TRIPS_FR`, `GARAGE_DEPARTURE` and `OTP_FIXED_ROUTE`
(migration-030:345–370) and referenced by **zero lines of code**. `assess.ts`
branches on `standard.code === "OTP_FIXED_ROUTE"` instead. The catalog advertises
a resolver registry that does not exist; adding a new automated standard today
means editing `assess.ts`, not adding a row.

**5. `measurement_source='auto'` is unenforced.**
A standard marked `auto` whose code `resolveThreshold` does not recognise falls
through to `ManualMetricEntries`, finds nothing, and scores `not_assessable` —
a silent downgrade rather than a loud configuration error.

**6. Six of the nine scored standards are manual-entry only** (`ADA_TITLE_VI`,
`SHUTDOWN_VEHICLE`, `INCIDENT_REPORTING`, `PREVENTABLE_COLLISIONS`,
`AVG_MILES_ROAD_CALLS`, `OPERATOR_CONDUCT`). Expected — Nexus and M5 are not
integrated — but nothing in the UI tells a manager that a "no data" month means
"nobody typed it in" rather than "nothing happened."

## Part 2 — KPI assignment to contractor

### What already exists

`migration-030` seeds the whole Attachment G catalog: 18 occurrence-based + 8
threshold standards, `is_scored` on the 9 High/Medium ones, `is_safety_critical`,
direction, unit, priority, responsible team. `ContractorStandardTiers` holds the
governing bands — OTP at ≥85% / 80–85 warning / 75–80 = $1,500 / <75 = $3,500;
missed trips $1,000 with a $2,000 last-trip qualifier; garage departure $500;
road calls banded on 12,000/11,000/10,000 miles; operator conduct 11/13/16 with
a CAP trigger at the top band. Tiers are date-effective, and
`AssessmentPeriodStandards` / `AssessmentPeriodTiers` snapshot them per period.

The hardcoded 90% OTP defect the design flagged is already corrected —
`otpMonthly.ts:11` now reads the tier and falls back to 0.85.

### Gaps that actually block "assigned to contractor"

**A. Standards are agency-global, not contractor-scoped.**
`ContractorPerformanceStandards` has no `contractor_id` or `agreement_id`, and
neither do the tiers. Every period cross-joins `WHERE is_scored=1`
(`assessmentPeriods.ts:44`). With one contractor this is correct; it cannot
express two contractors, or one contractor whose amended agreement carries a
different threshold. This is the core of the request.

**B. The schema hard-forbids a second contractor.**
`CREATE UNIQUE INDEX UX_PA_Active ON PerformanceAgreements(is_active) WHERE
is_active = 1` (migration-032b:26) is filtered on `is_active` *alone*, so exactly
one active agreement can exist system-wide. Any multi-contractor or overlapping-
amendment future starts by dropping this index.

**C. Nothing in the application ever creates a `PerformanceAgreement`.**
The only insert is migration-032b's one-time backfill, guarded by `NOT EXISTS
(SELECT 1 FROM PerformanceAgreements)`. If `Contractors` was empty when that
migration ran, adding a contractor through the console's "Manage contractors"
panel produces a contractor with **no agreement** — after which
`complianceCandidatesPoll` throws `50002 'No active Performance Agreement is
configured.'` on every run, and `assessmentPeriods.ts:34` cannot create a period
at all. It fails loudly, which is right, but there is no supported way to fix it
from the console. **Worth verifying against dev before anything else.**

**D. Standards Admin is read-only.**
`GET /performance-standards` is the only endpoint; there is no PUT or PATCH.
Attachment G reserves the right to amend thresholds by amendment, and the design
states "a contract amendment is a data edit, not a code change" — today it is a
SQL migration. Nothing in the console can change 85%, add a tier, flip
`is_scored`, or close a standard with `effective_end_date`.

**E. The read-only page hides the governing numbers.**
`AssessmentModule.tsx:71` renders tier label + dollar amount only. Not
`bound_low`/`bound_high`, not the qualifier, not `triggers_cap`, not direction,
unit, responsible team, or assignee. A manager cannot confirm from the console
that OTP tier 1 is the 75–80% band.

**F. `assigned_to` is free text, not a person.**
Values like `"Rob/Corrina"` are stored and never read — no query, no
notification, no UI column. Nothing routes a manual metric to its owner or
prompts them at month-end, which is the practical reason six scored standards
sit at "no data."

## Step 1 verification query

Steps 2 and 3 are built; step 1 needs a dev database connection this session
could not obtain (the server accepts no Entra token, and reading
`SQL_CONNECTION_STRING` from the Function App's settings is a secret read that
was refused). Run this read-only query against `sqldb-mvta-onboard-dev` **before
applying migration 102** and confirm the agreement row exists:

```sql
SELECT c.name, c.is_active AS contractor_active,
       a.id AS agreement_id, a.starts_on, a.ends_on, a.is_active AS agreement_active
FROM dbo.Contractors c
LEFT JOIN dbo.PerformanceAgreements a ON a.contractor_id = c.id
ORDER BY c.is_active DESC, c.name;
```

- **A row with an `agreement_id`** — nothing to fix; migration 102 backfills its
  standard assignments.
- **Contractors but no `agreement_id`** — this is gap C. Migration 102's
  backfill will find nothing to seed, and the new
  `PUT /performance-agreements/{id}` is how to create one afterwards (the
  Administration › Performance Standards page does it).
- **No contractors at all** — add one under Performance Assessment › Manage
  contractors first, then create the Agreement.

## Recommended build order

1. **Verify `PerformanceAgreements` on dev** (gap C) — query above. ⏳ *Awaiting
   a database connection; everything else below is built and does not depend on
   the answer, but nothing works on dev until an agreement exists.*
2. **`AgreementStandards`** — ✅ built as `migration-102-agreement-scoped-standards.sql`.
   Adds the assignment table and a nullable `agreement_id` on
   `ContractorStandardTiers`, re-keys `UX_PA_Active` on `(contractor_id,
   is_active)` and `UQ_CST_Version` to include the scope, backfills the active
   agreement from the catalog, and repoints the period snapshot in
   `assessmentPeriods.ts` at the agreement.
3. **Standards Admin write path** — ✅ built. `PUT /performance-standards/{id}`,
   `PUT /performance-standards/{id}/tiers` (versioned, transactional),
   `GET/PUT /performance-agreements` and
   `PUT /performance-agreements/{id}/standards`, all `OCC.Admin`. New page at
   **Administration › Performance Standards** showing the full band, qualifier,
   CAP flag, direction, unit, team and assignee, with add-a-standard for both
   occurrence and threshold types. The Assessment module's Standards tab stays
   read-only and links here.
4. **Cross-module links** — ✅ built. Confirming a missed trip raises its
   occurrence in the same transaction and asks for attribution at the same
   sitting (`lib/assessment/occurrenceIntake.ts`); a false positive retracts an
   occurrence already raised. Both Garage Departures views carry an Assessment
   column with inline Charge / Excusable / MVTA-directed. Missed Trips shows a
   reviewed trip's outcome and links into Performance Assessment. The Occurrence
   Log resolves `source_ref` back to the trip or block/run and links to
   Compliance. The link never fails a review, and never mutates a finalized
   month.
5. **Resolver registry** — ✅ built. `lib/assessment/resolvers/` holds the keyed
   entries; the OTP measurement moved into one; `assess.ts` looks the key up
   instead of branching on the standard's code. An unknown or absent key comes
   back not-measurable with the reason named, which scores `not_assessable`
   (partial period, exception required) rather than falling through to manual
   entry and reading as a clean month. Migration 103 snapshots `resolver_key`
   on the period so a catalog edit cannot change how a finalized month
   recomputes. Validation and the console picker both refuse a key the registry
   does not answer to, or one attached to the wrong kind of standard.
6. **Ownership** — resolve `assigned_to` to an Entra identity, and surface an
   open-manual-metrics list per owner at month-end close.

Steps 1–3 are the request as asked. Step 4 is the review finding. Steps 5–6 are
follow-on and can be deferred.
