# Ridership counting — build plan

Status: draft, 2026-10-30. Builds what `plans/ridership-counting-spec.md` agreed.
The UI follows the prototype on branch `claude/ridership-ui-0aa433`, which is
never merged (`/ridership?prototype=ridership` in a dev console): the worklist
opening the sheet form (§4) and the role-gated module (§10).

Facts this plan rests on were read from `main` on 2026-10-30 (v1.6.48, highest
migration 151, 152 taken by an open branch, highest ADR 0042).

## What already exists and gets reused

| Need | Existing seam |
|---|---|
| Trips on a sheet | `TripStartLog` (migration 094): `(service_date, trip_id)`, `block_id` in GTFS form, read as `001` by `workbookBlock()`. The materializer writes **today and tomorrow** at 04:30 local, so the next day's sheets can be printed the evening before. |
| Trips excused from a count | `TripStartLog.start_status IN ('missed','canceled')`, plus missed-trip cases confirmed in `MonitoredMissedTrips` (`classifyMissedTripCase`). |
| Operator and bus pre-fill | `FixedRouteDepartures` `(service_date, block, run)`: `operator_name`, `logon_id`, `vehicle_label`. Avail publishes the day's roster at about **02:30 on the day**, so pre-fill works at entry time (the day after), not at print time. A block can have **several runs** (relief). |
| Roles | ADR 0032: actions in `lib/access/catalog.ts`, roles seeded by migration and mirrored in `seeds.ts` and the console's `mockAccess.ts`. |
| Occurrences | `lib/occurrenceIntake/`, the only writer of `ComplianceOccurrences`. A new source kind with a unique `source_ref`; `INCIDENT_REPORTING` is already seeded. |
| Restatements | ADR 0039 / `OtpMonthlyRestatements`: an append-only shape. Ridership needs **who and why** as well, because restatements happen by hand. |
| Printing | No PDF or QR library in the repo. `lib/report/renderAssessmentReport.ts` already renders server-side HTML for letter-size print. |
| Schema drift | `lib/schemaDrift.ts` `SCHEMA_REQUIREMENTS`, plus 503 "run migration NNN" guards in handlers. |

**Missing:** day type (no function), a scheduled **end** time on `TripStartLog`,
and anything ridership-specific (no tables, no Access import).

## Increment 1 — live by 2026-12-01

Five PRs in order. Each bumps the version and adds a changelog file. PRs 1–2
are backend merges, which restart the REST app, so merge them outside
04:00–24:00 Central.

**PR 1 · Schema, module and roles** (migration 153, ADR 0043)
- Tables:
  - `RidershipSheets` `(service_date, block CHAR(3))`: operator name/ID, bus, `prefill_run`, `operator_overridden`, `reconstructed`, `entered_at/by`, `updated_at/by`.
  - `RidershipCounts` `(service_date, trip_id)`: `boardings`, `entered_at/by`.
  - `RidershipAddedTrips`: route, direction, start, reason, boardings.
  - `RidershipCountHistory`: every change with who and when (P6).
  - `RidershipBlockGarages` `(block, effective_from)` → garage.
- `TripStartLog.scheduled_end_seconds`, filled by the materializer from `GtfsScheduledTrips.last_arrival_seconds`, for the end time on sheets.
- Access:
  - A `ridership` module in `catalog.ts` with actions `view`, `enter`, `print`, `configure` (Increment 2 adds `flag.raise`, `month.complete`, `month.close`).
  - Seeded roles `ridership-recorder` (`view`, `enter`, `print`) and `ridership-manager` (all), mirrored in `seeds.ts` and `mockAccess.ts`.
  - Schema-drift entries for the new tables.
- ADR 0043: a count is keyed by the GTFS `trip_id` plus the service date; a sheet is a block plus a service date; garage comes from Planning's list, not Avail.

**PR 2 · Ridership API** (`lib/ridership/`, one module that owns the rules)
- The rules it owns: which trips need a count (§5), sheet state (entered / in progress / not entered / late / entered late, deadline in Central time), pre-fill from pull-out, and saving with history.
- Endpoints:
  - `GET /api/ridership/worklist?from=&to=` — sheets with state and garage, and completeness by garage.
  - `GET /api/ridership/sheets/{date}/{block}` — trips, statuses, pre-fill and saved values.
  - `PUT` the same path — gated `ridership.enter`; every required trip must have a count.
  - `GET` / `PUT /api/ridership/block-garages` — `PUT` gated `ridership.configure`.
- Tests: `node --test` unit tests for the rules, plus a `.db.contract.test.ts` for save and history.

**PR 3 · Console: Ridership page and entry**
- A Ridership entry under Specialist Operations, gated `ridership.view`.
- The Enter sheets tab is the prototype's flow, built on PR 2:
  - the worklist, late sheets first, garage cards to filter;
  - a row opens the full-width sheet form;
  - Enter moves down the trips and then to Save; Save goes to the next sheet; Esc returns to the worklist;
  - unscheduled trips, Reconstructed, and the operator/bus override.
- Administration → Ridership setup (block → garage), listed once in `adminNav.ts`.
- Vitest tests for the keyboard flow and gating.

**PR 4 · Count Sheet printing**
- A server-rendered HTML sheet per block for a service date, letter size, one block per page, in the style of `renderAssessmentReport`.
- `GET /api/ridership/print?date=&garage=` (`ridership.print`), opened from the Print sheets tab. The contractor prints it from the browser, so no nightly job is needed: tomorrow's trips already exist.
- QR code: see decision 2.

**PR 5 · Parallel-run comparison for December**
- A daily totals CSV by route, direction and day, so Planning can compare December against Access.
- This needs a simple day type (weekday / Sat / Sun from the GTFS services). The full day-type rule is in Increment 2.

**Steps outside the code**, in order (spec §11 lists the owners):
1. Apply migration 153 to dev, then to prod.
2. Assign `ridership-manager` to the named Planning staff in Access & Identity.
3. Create Entra B2B guest accounts for Keolis OCC staff and assign `ridership-recorder`.
4. Planning enters the block → garage list.
5. Rehearse with OCC on dev the week of 2026-11-23.

## Increment 2 — by 2027-01-01

- **Day type** (`lib/serviceDayType.ts`): Wk / Sat / Sun / SpSat from the GTFS service a trip ran under (§9). Stored on each count when it is saved.
- **Flags** (migration):
  - `RidershipFlags` (rule or Planning; answer kind, value, note, who) and `RidershipSettings` (the three thresholds).
  - The 4-week median per trip is matched on route, direction, scheduled start and day type, not on `trip_id`, because trip IDs change at a service change.
  - The Flags tab; the flag check runs when a sheet is saved.
- **Month close**:
  - `RidershipMonths` (complete, closed, reopened, with who and why).
  - `RidershipRestatements`, following ADR 0039 plus who and why.
  - Saves to a closed month are blocked.
- **Totals and export:** the `FixedTotals`-shaped export, with operator names gated by role. ServiceType stays blank until decided.
- **History import:** a one-off import of Access `FixedTotals`.

## Increment 3 — early February 2027 (January close)

- A `ridership-sheet` source in `occurrenceIntake`, with `source_ref` `ridership:<YYYYMMDD>:<block>`.
- Candidates are raised when a month is closed: a sheet that is missing, late or has a flag still open.
- The compliance manager confirms them in the existing Compliance review, which feeds `INCIDENT_REPORTING`.

## Decisions needed before PR 1

1. **A trip the operator didn't count.** The prototype refuses to save a sheet with a blank. Choose: allow "Not counted" per trip (it shows as a gap and counts toward completeness), or require a number.
2. **QR code on the sheet.** The spec has it (§3), but nothing reads it until operator self-entry (v2). Choose: add a QR library now, or print the block and date in large type and add QR later.
3. **Dec 1 target environment.** Contractor staff enter on **prod** from Dec 1? Prod exists, but its timers are mostly off. `tripStartLogMaterialize` and `tripStartActualsPoll` are already enabled early there, and `fixedRouteDeparturesPoll` would also need enabling.
4. **Relief on a block.** When a block has several runs, the sheet header pre-fills the first run's operator. Choose: show every run's operator, or keep one operator per sheet and treat relief as an override.
5. **"Did not operate" and blank rows for unscheduled trips** on the printed sheet. Both are in the procedure draft but not formally decided.
6. **Trip ID in exports.** OnBoard keys on the GTFS `trip_id`; Access used its own TripID. Choose whether the export carries both for December's comparison.
