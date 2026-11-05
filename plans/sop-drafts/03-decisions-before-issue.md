# Ridership SOP — decisions before issue (DRAFT)

**Status:** updated 2026-11-04. Questions MVTA must settle before OPR-038's
amendments (`01-opr-038-amendments.md`) and the new SOP
(`02-ridership-counting-and-reporting-sop.md`) go to the Contractor. The SOP
no longer marks them inline: on 2026-11-04 the draft's wording was taken as
the decision for every item it marked, and the items still open below don't
change its text.

## Decisions

### Still open

| # | Decision | Where | Owner | Draft says now |
|---|---|---|---|---|
| 1 | SOP code for Ridership Counting and Reporting | Header, OPR-038 citations | Document registry | OPR-RID-00 (OPR-XXX-00 is taken by the Surveillance Video SOP in OPR-038) |
| 6 | Whose staff "Contractor OCC staff" are. OPR-038 defines the OCC as MVTA's unit, but the spec has the Contractor keying sheets | Responsibilities | Operations | Contractor staff, holding the Ridership recorder role |
| 13 | Which contract number to cite. OPR-038 cites C-10235; the Keolis contract may carry another | References | MVTA contracts | C-10235 |
| 15 | What "accepts the result" means for the Parallel Run, e.g. monthly totals agree within an agreed % (R6 in PR #459) | Transition, step 3 | Planning | MVTA Planning sets it; no test written |
| 19 | Scan-and-upload entry. The user named it as an entry method (sheets scanned and uploaded to OnBoard up to 3 times a day), but neither the spec nor the build has it | Pull-In and Sheet Collection, NOTE | Planning + Engineering | Mentioned as a method MVTA may enable |

### Decided

| # | Decision | Decided | Now in the SOP |
|---|---|---|---|
| 2 | Unscheduled-trip rows and "Did not operate" on the sheet | 2026-11-01, by the built sheet (#474) | Unscheduled trips rows; a DNO tick box, total left blank |
| 3 | When sheets print | 2026-11-02 (user, with the print work) | The check-in desk prints the next day's sheets each evening and reprints changed sheets each morning before pull-out |
| 4 | What the garage does if OnBoard can't print | 2026-11-02 (user) | Blank sheets, filled in by hand |
| 8 | Who keys the Parallel Run in OnBoard | 2026-10-30 (user); replaced 2026-11-03 | Replaced by the Parallel Run by scanning: the incumbent keys Access only, and staff MVTA designates enter the scans in OnBoard |
| 9 | How often sheets go from the desk to OCC | 2026-11-02 (user) | Up to three times a day for OCC keying; at the end of the shift for Operator entry; up to three times a day for scan and upload |
| 10 | How quickly a paper sheet is produced on request | 2026-11-02 (user) | One business day |
| 14 | Notice before each transition stage | 2026-11-02 (user) | 14 calendar days |
| 17 | Interlined passengers | 2026-11-02 (user) | Not counted again; a Count is boardings only |
| 18 | Answering a Flag raised after the 5th | 2026-11-02 (user) | One business day |
| 5 | Criteria that let APC replace the Count Sheet (gap C8) | 2026-11-04 (user), as drafted | Paper on every trip until MVTA authorizes a bus or route in writing; the criteria come with the APC comparison work |
| 7 | Reporting Failures and Attachment G (gap C4; briefing O-3) | 2026-11-04 (user), as drafted | Assessed under Attachment G's Incident and Data Reporting standard as written |
| 11 | Deadheads and special events (gap C7; briefing O-10) | 2026-11-04 (user), as drafted | Both out of scope; special-event counts covered separately |
| 12 | Definitions and the MVTA Master Transit Glossary | 2026-11-04 (user) | The claim that each definition aligns with the glossary is removed; the definitions stand on their own and the glossary stays a reference |
| 16 | Who in MVTA gives the transition notices and APC authorizations | 2026-11-04 (user), as drafted | MVTA Operations |
| — | Printing ahead | 2026-11-04 (user) | Nightly is the rule; a desk not staffed every evening may print up to three service dates ahead (e.g. Friday for Saturday–Monday), with the morning reprint still daily. Needs PR #505, which builds the Dispatch Log three days ahead |
| — | Who prints (briefing O-8) | 2026-11-02, Ridership printer role (#483) | Check-in desk staff hold the Ridership printer role |
| — | When Reporting Failures are assessed (briefing O-1) | 2026-11-02 (user) | From the Cutover Date, subject to Attachment G's Transition (months 1–3, occurrence penalties suspended for non-safety measures) and Ramp-Up (months 4–6, 50%) Periods |
| — | Cutover before the Parallel Run month closes (briefing O-4) | 2026-11-02 (user) | MVTA may set the Cutover Date on a partial-month comparison; Access stays available until the full month is accepted |
| — | Shape of the Parallel Run (briefing, 2026-11-03) | 2026-11-03 (user) | It starts on the 7 December 2026 service change. Sheets are printed from OnBoard, keyed into Access only by the incumbent's OCC, and scanned daily. Staff MVTA designates (the incoming Contractor's OCC in training) enter scans in OnBoard for the comparison. The deadline and flags do not apply until the Cutover Date |

## Added in the SOP beyond the agreed spec

These aren't in `plans/ridership-counting-spec.md`. Keep, change or strike
each one.

- **Trips after midnight** belong to the service date on which their block
  began (Definitions, Service Date).
- **A bus change mid-block** is written beside the first trip on the new bus
  (Counting on the Trip, step 1).
- **DNO ticked, not 0**, for a trip that didn't run (step 6), as the built
  sheet says.
- **Don't write on the sheet while the bus is moving**: the REQUIREMENT
  callout in Counting on the Trip, in line with OPR-038's Operator Conduct.
- **The check-in desk checks the sheet** before the Operator leaves (Pull-In,
  step 2).
- **Contractor management reviews completeness weekly** (Monitoring, step 2).
- **The parallel run is practised but not assessed** (Transition, step 6).
- **A return to Access** if MVTA directs it after the Cutover Date (Transition, step 7).
- **A change of contractor doesn't restart a stage** (Transition, NOTE).
- **Refresher training each year**, and OnBoard access requested and removed
  through the IT Service Desk (Training and Access).
- **Escalation rows** for sheets that can't print, sheets not returned,
  OnBoard down, Unassigned blocks and sheets at risk of missing the deadline.
- **The Purpose names NTD reporting** as a use of the counts. Check this.
- **Keep counting on any paper** if the sheet is lost mid-block (Lost or
  Damaged, step 1).
- **Flag thresholds moved to a NOTE "at issue"**, so a change Planning makes
  in OnBoard doesn't make the SOP wrong; the rule itself stays general.
- **"Missing" means still not entered at Month Close**, so a sheet is missing
  or late, never both.
- **Table additions:** escalation rows for an APC counter that isn't active,
  Access down before cutover, and access removal when someone leaves; records
  rows for Access-era counts, the Parallel Run acceptance, transition notices
  and APC authorizations; a Reporting Failures metric with a target of none.
- **An MVTA Operations role** for the transition notices and APC
  authorizations (decision 16).

## Changes from the spec

If MVTA's answers differ from the spec, the SOP follows MVTA, and the change
is recorded here.

Decided with the user, 2026-10-30:

- **No fixed dates.** The spec has December 2026 as the parallel run and
  1 January 2027 as cutover. The SOP instead describes three stages (current
  process, parallel run, OnBoard only), each started by MVTA's written
  notice. The reason: the dates may not be achievable, and the SOP must stay
  correct if they slip, including past the change of contractor.
- **The parallel run uses the OnBoard-printed sheet**, keyed into both
  OnBoard and Access, rather than the current sheet.
- **The Contractor's OCC staff key both systems** during the parallel run.
- **The OPR-038 amendments take effect with the new SOP**, not before.

Decided with the user, 2026-11-02:

- **Printing.** The spec (§3, §10) has OnBoard producing sheets overnight and
  "print sheets" held by the Ridership recorder (OCC). Instead the garage
  check-in desk prints the next day's sheets each evening under a Ridership
  printer role, and the morning desk reprints any sheet the early-morning
  schedule refresh marked changed. Sheets must not be photocopied: each is
  coded to one block and service date.
- **Assessment start.** The spec (§8) has no grace period. Reporting Failures
  follow Attachment G's own Transition (months 1–3) and Ramp-Up (months 4–6,
  50%) Periods.
- **Conditional cutover.** The Cutover Date may come before the Parallel Run
  month closes, with Access kept as a fallback until it is accepted.
- **A Count is boardings only**; interlined passengers are not counted again.

Decided with the user, 2026-11-03:

- **Parallel Run by scanning.** The spec (§11) has December keyed in both
  Access and OnBoard by the Contractor's OCC staff. Instead, from the
  7 December 2026 service change, sheets are printed from OnBoard, keyed only
  into Access, and scanned; OnBoard entries for the comparison are made from
  the scans by staff MVTA designates. Decision 8 (who keys the Parallel Run in
  OnBoard) is replaced by this.

## Later sections

- **Operator mobile app.** If operators enter their own counts (spec §13), a
  section on it gets added once the driver-app work settles the device and
  rollout.
- **APC comparison.** Decision 5 gets its criteria once the APC comparison
  work (spec §12) has data.
