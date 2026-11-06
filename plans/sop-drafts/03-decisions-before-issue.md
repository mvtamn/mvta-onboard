# Ridership SOP — decisions before issue (DRAFT)

**Status:** updated 2026-11-02. Questions MVTA must settle before OPR-038's
amendments (`01-opr-038-amendments.md`) and the new SOP
(`02-ridership-counting-and-reporting-sop.md`) go to the Contractor. Each is
marked **[Decide]** where it appears in the SOP.

## Decisions

### Still open

| # | Decision | Where | Owner | Draft says now |
|---|---|---|---|---|
| 1 | SOP code for Ridership Counting and Reporting | Header, OPR-038 citations | Document registry | OPR-RID-00 (OPR-XXX-00 is taken by the Surveillance Video SOP in OPR-038) |
| 5 | Criteria that let APC replace the Count Sheet on a bus or route (gap C8) | Automatic Passenger Counters, step 3 | Operations + Planning | Paper on every trip until MVTA authorizes it in writing |
| 6 | Whose staff "Contractor OCC staff" are. OPR-038 defines the OCC as MVTA's unit, but the spec has the Contractor keying sheets | Responsibilities | Operations | Contractor staff, holding the Ridership recorder role |
| 7 | Whether ridership Reporting Failures fall under Attachment G's Incident and Data Reporting standard as written, or Attachment G needs amending (gap C4; briefing O-3) | Reporting Failures, step 3 | MVTA contracts | Assessed under Incident and Data Reporting |
| 11 | Whether deadheads and special events are out of scope, and where special-event counts are covered (gap C7; briefing O-10) | Scope | Planning | Both out of scope; special events "covered separately" |
| 12 | Definitions checked against the MVTA Master Transit Glossary | Definitions | Document owner | Not checked |
| 13 | Which contract number to cite. OPR-038 cites C-10235; the Keolis contract may carry another | References | MVTA contracts | C-10235 |
| 15 | What "accepts the result" means for the Parallel Run, e.g. monthly totals agree within an agreed % (R6 in PR #459) | Transition, step 3 | Planning | MVTA decides; no test written |
| 16 | Who in MVTA gives the transition notices and APC authorizations | Responsibilities, MVTA Operations | COO | MVTA Operations |
| 20 | Whether OCC may fill a Reconstructed Count Sheet's Not counted trips from the bus's APC Counts, with APC recorded as the source. OnBoard's entry form has no source field today, so a yes needs a build change | Lost or Damaged Count Sheets, step 5 | Planning | No: the trip stays Not counted |
| 19 | Scan-and-upload entry. The user named it as an entry method (sheets scanned and uploaded to OnBoard up to 3 times a day), but neither the spec nor the build has it | Pull-In and Sheet Collection, NOTE | Planning + Engineering | Mentioned as a method MVTA may enable |

### Decided

| # | Decision | Decided | Now in the SOP |
|---|---|---|---|
| 2 | Unscheduled-trip rows and "Did not operate" on the sheet | 2026-11-01, by the built sheet (#474) | Unscheduled trips rows; a DNO tick box, total left blank |
| 3 | When sheets print | 2026-11-02 (user, with the print work) | The check-in desk prints the next day's sheets each evening and reprints changed sheets each morning before pull-out |
| 4 | What the garage does if OnBoard can't print | 2026-11-02 (user) | Blank sheets, filled in by hand |
| 8 | Who keys the Parallel Run in OnBoard | 2026-10-30 (user) | The Contractor's OCC staff at the time |
| 9 | How often sheets go from the desk to OCC | 2026-11-02 (user) | Up to three times a day for OCC keying; at the end of the shift for Operator entry; up to three times a day for scan and upload |
| 10 | How quickly a paper sheet is produced on request | 2026-11-02 (user) | One business day |
| 14 | Notice before each transition stage | 2026-11-02 (user) | 14 calendar days |
| 17 | Interlined passengers | 2026-11-02 (user) | Not counted again; a Count is boardings only |
| 18 | Answering a Flag raised after the 5th | 2026-11-02 (user) | One business day |
| — | Who prints (briefing O-8) | 2026-11-02, Ridership printer role (#483) | Check-in desk staff hold the Ridership printer role |
| — | When Reporting Failures are assessed (briefing O-1) | 2026-11-02 (user) | From the Cutover Date, subject to Attachment G's Transition (months 1–3, occurrence penalties suspended for non-safety measures) and Ramp-Up (months 4–6, 50%) Periods |
| — | Cutover before the Parallel Run month closes (briefing O-4) | 2026-11-02 (user) | MVTA may set the Cutover Date on a partial-month comparison; Access stays available until the full month is accepted |

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
- **How a lost sheet is reconstructed** (added 2026-11-05, user). OPR-038
  says only "as accurately as possible". The SOP now says: reconstruct
  before leaving at pull-in, on a reprinted sheet; copy the tally for later
  trips; write earlier trips only when confident, and mark the rest "not
  recalled" (entered as Not counted), never an estimate or 0; the desk or Garage Manager initials it with
  how it was lost. A sheet lost after hand-in is reported to Planning the
  same day and entered as Not counted. It is not rewritten from memory.
  Filling from APC is decision 20.
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

## Later sections

- **Operator mobile app.** If operators enter their own counts (spec §13), a
  section on it gets added once the driver-app work settles the device and
  rollout.
- **APC comparison.** Decision 5 gets its criteria once the APC comparison
  work (spec §12) has data.
