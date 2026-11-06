# Ridership in OnBoard: plan to finish the features, with QA

Status: draft, 2026-11-03. **Not implemented.** This plan sequences the ridership
work still to be built in OnBoard against the transition dates agreed on
2026-11-03 (plan A), and sets out how each piece is tested and signed off.

Scope: the fixed-route ridership features only. Other OnBoard modules are not
covered. The kiosk, operator PIN sign-in and phones are listed under Later for
completeness, but they are not planned in detail here.

Sources:
- the build plan and spec (`plans/ridership-build-plan.md` and
  `plans/ridership-counting-spec.md`, PR #455);
- the contractor briefing and its action list (`plans/contractor-ridership-briefing.md`, PR #463);
- the SOP drafts (`plans/sop-drafts/`, #486);
- scan upload (`plans/count-sheet-scan-upload.md`, PR #488);
- reporting (`plans/ridership-reporting-spec.md`, PR #475);
- the reconciliation review (PR #459);
- `main` at 3714cd95 (v1.7.22, highest migration 162).

## 1. The dates everything works back from

| Gate | Date | What must be true |
|---|---|---|
| G1 Print rehearsal | week of **2026-11-16** | Printing works on prod at both garages for the current schedule; desk staff have Ridership Printer |
| G2 Dress rehearsal | **2026-11-29/30** | A full next-day stack per garage, morning reprint, scan to the folder |
| G3 Go/no-go | **2026-12-04** | G2 passed; block-to-garage list for the 7 Dec schedule complete; print path frozen |
| G4 First live print | evening of **2026-12-06** | The Dispatch Log holds 7 December's trips by 03:30 on the 6th |
| G5 Keolis keys scans | **2026-12-09 → 12-18** | Keolis OCC can enter on prod; scans reachable; operator and bus pre-fill working on prod |
| G6 Cutover notice | **2026-12-18** | Planning's trip-by-trip comparison of OnBoard (from scans) with Access is done and accepted |
| G7 OnBoard only | **2027-01-01** | Keolis enters every sheet in OnBoard; counts carry their day type; deadline and late states live |
| G8 Flags training | **2027-01-08** | Flags and their answers live (briefing A-16) |
| G9 December import | **mid-January 2027** | December's Access close done; history imported with control totals |
| G10 January close | **2027-02-01 → 02-12** | Month complete and month close live; occurrence candidates raised at close; first Transition Period report on 02-12 |

## 2. Where it stands (built and live)

Everything below is merged. Migrations 153, 154, 157, 159, 161 and 162 are
applied on **dev and prod**.

| Feature | PRs | Version |
|---|---|---|
| Schema, `ridership` module, `ridership-recorder` and `ridership-manager` roles (ADR 0043) | #457 | 1.6.50 |
| Ridership API: worklist, sheet get/save with history, block-garage list, deadline and late states | #465 | 1.6.51 |
| Console: Ridership page, Enter sheets (worklist and keyboard sheet form), Ridership setup | #469 | 1.6.56 |
| Count Sheet PDF per garage, print log, changed-since-printed | #474, #476 | 1.6.70, 1.6.72 |
| Route number on the sheet; morning reprints; bulk garage assign; Unassigned warning; Ridership Printer role; Avail trip numbers; relief/bus-change line | #478, #482–#485, #489, #490 | 1.6.75–1.7.22 |

## 3. What is left, by gate

Each item is one PR unless noted. **Size**: S is under a day, M a few days, L a
week or more. Following the repository's rule, a PR that changes
`functions-restapi` restarts the REST app when it merges, so it merges
**outside 04:00–24:00 Central**, and from 2026-12-06 also outside the
evening print window.

### 3.1 Before G1–G4 (December printing): configuration and one guard

None of these needs new feature code except W1-3.

| # | Item | Kind | Size | Gate |
|---|---|---|---|---|
| W1-1 | **Turn on operator and bus pre-fill on prod.** `fixedRouteDeparturesPoll` is **not** in prod's `restApiTimersEnabledEarly` (`infra-phase1/parameters/phase1-prod.parameters.json`), so prod sheets open with no operator or bus. Build-plan decision 3 called for adding it. One-line infra PR, deployed through the prod gate | Infra | S | G5 (before Keolis keys) |
| W1-2 | **Block-to-garage list on prod**: the current schedule for G1, then the 7 December blocks (briefing A-7a) | Configuration | S | G1, G3 |
| W1-3 | **Service-change readiness check** on Print sheets: warn when the chosen date has **no trips** in the Dispatch Log, or when any block is Unassigned. The Unassigned half exists (1.7.8). The no-trips half catches a 7 December GTFS that has not loaded (A-7b) before the desk prints an empty stack | Code (console + API) | S | G3 |
| W1-4 | **Print-path freeze**: no merge touching `lib/ridership/print*`, `countSheetPdf.ts`, `PrintSheets.tsx` or the Dispatch Log materializer from **2026-12-02 to 12-08**, unless it fixes a G2 defect | Process | — | G3–G4 |

### 3.2 Before G5–G6 (the December comparison)

| # | Item | Kind | Size | Gate |
|---|---|---|---|---|
| W2-1 | **Confirm the Access TripID rule** against the Access table (build-plan decision 6; spec §16 gives day type + route + direction + HHMM). This is a check of data, not code, but W2-2 depends on it | Data check | S | before W2-2 |
| W2-2 | **Parallel-run comparison** (build-plan PR 5, reshaped for plan A). A per-trip export of OnBoard counts for a date range, with service date, block, route, direction, scheduled start, GTFS `trip_id`, the **Access-style TripID**, a simple day type (Wk/Sat/Sun from the GTFS service), count status and boardings. **Recommended addition:** Planning uploads the Access export for the same dates and OnBoard lists the trips that differ (missing on either side, different count), so the comparison is trip by trip as SOP step 4 requires, not by eye in Excel | Code (API + console) | M | G6 (needed by **12-14**) |
| W2-3 | **Mark December's OnBoard entries as parallel-run entries.** Under plan A, December stays an Access month and the history import (W3-6) brings December in from Access. So the Keolis training entries in OnBoard for 7–31 December must not count as a second set of December figures. Proposal: entries saved for a service date before the Cutover Date carry `entry_stage = 'parallel'`, are excluded from totals and exports by default, and are kept for the comparison. See decision Q1 | Code (migration + API) | S | G5 (before Keolis's first save) |
| W2-4 | **Scans reachable by Keolis OCC while keying**: the interim shared folder (briefing A-7c), opened beside OnBoard. No code. Access is restricted to the ridership roles, because the scans carry Operator names | IT | S | G5 |

### 3.3 Before G7–G9 (OnBoard only, flags, December import) — build-plan Increment 2

| # | Item | Kind | Size | Gate |
|---|---|---|---|---|
| W3-1 | **Day type** (`lib/serviceDayType.ts`): Wk/Sat/Sun/SpSat from the GTFS service a trip ran under, **stored on each count when it is saved**, so January's data is right from day one | Code | M | **G7 (must)** |
| W3-2 | **FixedTotals-shaped export and the trip × date grid** (reporting spec, Jan 1 items): month by route, direction and day type, with trips operated and riders counted only; the grid replaces Planning's Access crosstab and carries the Access TripID. ServiceType stays blank (unsettled) | Code | M | G7 |
| W3-3 | **Flags**: `RidershipFlags` and `RidershipSettings`; the 4-week median matched on route, direction, scheduled start and day type; the check runs on save; the Flags tab for OCC answers and Planning-raised flags. A DNO tick that disagrees with the Dispatch Log or a missed-trip case is a question, not an automatic correction | Code (migration + API + console) | L | G8 |
| W3-4 | **Month complete, close and reopen**: `RidershipMonths` with who and why, `RidershipRestatements` (ADR 0039 shape plus who and why), saves blocked in a closed month, new actions `month.complete` and `month.close` | Code (migration + API + console) | L | G10 (needed by **2027-01-29**) |
| W3-5 | **Reporting API for Power BI** (reporting spec): read-only `/api/reporting/ridership/*` behind a function key, with the four feeds and no operator names | Code | M | G9 |
| W3-6 | **History import** of Access `FixedTotals` (and December's trip-level data, if decision Q1 keeps it): a one-off import taken after December's Access close, with a **control total per month** checked against Access (reconciliation review R-gap) and repeatable if the cutover slips | Code + data | M | G9 |

### 3.4 Before G10 (January close and the first assessment) — build-plan Increment 3

| # | Item | Kind | Size | Gate |
|---|---|---|---|---|
| W4-1 | **Occurrence source** `ridership-sheet` in `occurrenceIntake`, `source_ref` `ridership:<YYYYMMDD>:<block>`, candidates raised at month close for a sheet that is missing, late or has a flag still open; confirmed in the existing Compliance review; Transition Period (Jan–Mar) shown and not charged | Code | M | G10 |
| W4-2 | Reporting early-February items: drill-down, garage view, "Reported on" marker, first Power BI report | Code + Power BI | M | early Feb |

### 3.5 Scan capture (PR #488), off the critical path

The shared folder covers December, so capture is not needed for any gate. It
starts once W3-1 and W3-3 are merged.

| # | Item | Size | Target |
|---|---|---|---|
| W5-1 | Upload page and a `ridership.scan` action (upload but not view), batch PDF straightened on the corner marks, split by QR code, stored in a WORM container with the policy unlocked until retention is set; image views limited to the ridership roles and logged | L | late January 2027; then load December's folder batches |
| W5-2 | Reading trial on December's real sheets (labelled by Access), then proposals for OCC after the January close | L | February–March 2027 |

### 3.6 Later (not planned here)

The operator kiosk (#461, #462), operator PIN sign-in (#487), and phones once
OPR-038 is amended (#458). The earliest of these is the kiosk pilot, after the
March 2027 close. Their QA follows the same pattern as section 4, plus device
and sign-in security testing.

## 4. QA

### 4.1 What every PR must pass (automated, in CI)

These gates already exist in `api.yml` and `frontend.yml`. Every ridership PR
uses all of them; none is optional.

1. **Migration number check** (`check-migration-numbers.sh` against `main`). Also check the claimed version against **every open PR**, not just `main`, because versions race.
2. **API unit tests** (`node --test`). New rules go in `lib/ridership/*.test.ts`, alongside `rules.test.ts` and `print.test.ts`. Required for every rule: deadline at the Central day boundary, DST weeks, after-midnight trips on the block's service date, relief blocks, and DNO and Not counted never counted as 0.
3. **DB contract tests** (`*.db.contract.test.ts`, listed in `test:decision-matrix-contract`). Every new table and store function gets one, along with a `migrationNNN.db.contract.test.ts` for each migration. The list in `package.json` is explicit: **add the new file to it**, or it never runs.
4. **Console typecheck and vitest**. Use `npm run typecheck` (tsc -b) and `npm test`, run after `npm ci` and `npm run build:shared`. Required: role gating for each tab, the keyboard flow for any new form, and empty and error states.
5. **Schema drift entries** (`lib/schemaDrift.ts`) for each new table or column, so the health page says when an environment is behind.

### 4.2 Acceptance checks per item (on dev, before merge)

Each PR description lists its acceptance checks as Given/When/Then lines, and
the author runs them on dev with the console. The key ones:

| Item | Acceptance checks |
|---|---|
| W1-3 | A date with no Dispatch Log trips shows the warning and the Print button explains why; a date with an Unassigned block names the blocks; a normal date shows neither |
| W2-2 | Export row count = required trips for the range; Access TripIDs match ten hand-checked trips from the Access table; an uploaded Access file with one changed count, one extra and one missing trip produces exactly those three differences |
| W2-3 | A sheet saved for 2026-12-10 is `parallel`, absent from totals and exports by default, present in the comparison; a sheet for 2027-01-02 is not |
| W3-1 | One trip of each service (weekday, Saturday, Sunday, a special Saturday) gets the right day type; a holiday running Sunday service is Sun |
| W3-3 | A count over the threshold raises one flag; answering it clears it from the open list with who and when; re-saving the sheet does not duplicate it; thresholds change only with `ridership.configure` |
| W3-4 | Complete is refused with open flags or missing sheets (or records why, per decision Q4); a save into a closed month is refused; a reopen needs a reason and leaves a restatement |
| W3-6 | Control totals per month equal Access's `FixedTotals` to the rider; re-running the import is a no-op |
| W4-1 | Closing a test month with one missing, one late and one open-flag sheet raises exactly three candidates with the right `source_ref`; re-closing raises none |

### 4.3 Physical and operational QA (people and paper)

These cannot be tested in CI, and the briefing already schedules them.
QA adds a checklist and a recorded result for each:

| Test | When | Pass means |
|---|---|---|
| Print on each garage's real printer | G1 (A-8a) | Letter size with no scaling; every line and digit box intact; the blank back is blank when duplex is on; pull-out order matches the desk's issue order |
| QR read | G1 and G2 | A phone and a USB scanner each open the right sheet from 20 printed sheets, including a creased one |
| MFP scan at 300 dpi | G2 | The batch PDF reaches the folder; spot-checking 10 pages finds the corner marks, QR and totals legible. This also tests #488's assumptions on real paper |
| Morning reprint | G2 | A block changed after the print (a test tripper) shows Changed and reprints alone |
| Keying from scans | G5, first day | Two Keolis OCC staff each key 20 scanned sheets; time per sheet is recorded; their questions feed the quick guide |
| Comparison | G6 | Every difference between OnBoard and Access for 7–15 December is explained as a keying error on one side, a sheet-reading question, or a defect (logged) |
| Role check | each grant | Each person signs in and sees only their tab: a printer cannot enter, and a recorder cannot change setup |

### 4.4 Environments and test data

- **Build and acceptance on dev.** Build-plan decision 3 puts the OCC rehearsal on **prod with a test service date**, so prod will hold test sheets. Before G1, settle how they are removed. **Recommended:** a `ridership-manager`-only "discard rehearsal sheets for date X" action, logged, refused for any date on or after the Cutover Date. Otherwise, a reviewed one-off SQL script. See decision Q2.
- **Migrations go to dev first, then prod**, and the health page's schema drift check is clean on both before a gate.
- **No real operator names or IDs** in tests, fixtures, screenshots or PR text. Use synthetic sheets rendered by `countSheetPdf.ts`.

### 4.5 Sign-off (UAT)

| Gate | Signs off | On |
|---|---|---|
| G3 go/no-go | Planning (ridership-manager) and Operations | The G2 checklist, W1-1 to W1-3 done, and the freeze in place |
| G6 cutover notice | Planning recommends, COO decides | The W2-2 comparison report |
| G7 OnBoard only | Planning, plus Keolis's OCC lead for usability | W3-1, W3-2 and W2-3 live on prod; a scripted UAT of a full day: print, enter, late, correct |
| G8, G10 | Planning; the Compliance manager for W4-1 | A scripted UAT on a test month on dev, then the first real month on prod |

### 4.6 Defects and support during the run

- **Severity**:
  - **S1**: no sheets can be printed or entered at a garage. Fix or fall back the same evening.
  - **S2**: wrong data on a sheet or a wrong total. Fix before the next print.
  - **S3**: everything else, which goes into the next PR.
- **Fallback for S1 on a print night**: the print fallback already decided in #486. Engineering is reachable each evening from 6 to 9 December and on 2 January.
- **Watching**: Application Insights failures on `ridership/*` and the 03:30 materializer run are checked every morning from 12-06 to 12-12 and from 01-01 to 01-08. A missing materializer run blocks the evening print.

## 5. Calendar

| Week of | Build | Test and people |
|---|---|---|
| 11-02 | W1-1 (infra PR), W2-1 (Access TripID check), decision Q1 | — |
| 11-09 | W1-3, W2-3 | Block list for current schedule (W1-2); grants for desks |
| 11-16 | W2-2 | **G1** print rehearsal at both garages |
| 11-23 | W2-2 finished; W3-1 started (Thanksgiving 11-26) | Block list for 7 December (W1-2) |
| 11-30 | W3-1; freeze from 12-02 | **G2** 11-29/30; **G3** 12-04 |
| 12-07 | W3-2, W3-3 started (merges outside the print window) | **G4** 12-06; **G5** Keolis keys from 12-09; daily watch |
| 12-14 | W3-3 | Comparison report by 12-16; **G6** 12-18 |
| 12-21 | W3-3 finished; W3-5 | Scripted UAT for G7 on dev |
| 12-28 | Freeze from 12-30 to 01-02 | **G7** 01-01 on prod |
| 01-04 | W3-4, W3-6 (after December's Access close) | **G8** 01-08 flags training |
| 01-11 → 01-25 | W3-4 finished by 01-29; W4-1; W5-1 started | **G9** import with control totals |
| 02-01 | W4-2 | **G10** January close; candidates; 02-12 report |

The critical chain is **W2-3 → W2-2 → G6**, then **W3-1 → G7**. The largest
items, W3-3 and W3-4, have three to four weeks of slack each. If capacity is
short, W3-5 and W5 move first, and the gates do not.

## 6. Steps outside the code (numbered)

1. Merge and deploy W1-1 through the prod gate, then confirm pull-out rows on prod the next morning.
2. Check the Access TripID rule against the Access table (W2-1). Planning provides a query export.
3. Planning enters the block-to-garage list on prod: the current schedule by 11-16, the 7 December schedule by 12-04.
4. MVTA IT creates Entra B2B guest accounts for the incumbent's desk staff (by 11-16) and Keolis OCC and desks (by 12-11).
5. An access administrator assigns **Ridership Printer** to each desk person, `ridership-recorder` to each Keolis OCC person, and `ridership-manager` to named Planning staff. These are app-owned roles (ADR 0032), assigned in Access & Identity.
6. When W3-4 ships, assign the new `month.complete` and `month.close` actions to the right roles (recorder and manager), and record it in the PR.
7. When W5-1 ships, assign the new `ridership.scan` action to the desk or garage role that uploads.
8. Apply each new migration to dev, then prod, before the gate that needs it, and confirm the drift check is clean.
9. MVTA IT sets up the MFP scan-to-folder route and the restricted shared folder at each garage (A-7c) by 12-04.

## 7. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| Q1 | What happens to Keolis's December OnBoard entries once December is imported from Access | Keep them, marked `parallel`, for the comparison record only; Access is December's figure (W2-3) |
| Q2 | How rehearsal sheets on prod are removed | A logged manager-only discard action, refused on or after the Cutover Date |
| Q3 | Whether the comparison needs the Access-upload diff (W2-2's addition) or an export is enough | Build the diff: the SOP says trip by trip, and by eye is the gap (P4) the transition is meant to close |
| Q4 | Whether month complete can be declared with sheets still missing (reconciliation review) | Allowed with a reason per missing sheet, which becomes the occurrence evidence |
| Q5 | Engineering cover on print nights (6–9 Dec, 1–2 Jan) | A named on-call for those evenings |
