# Ridership counting in OnBoard: status board

A living status board for moving fixed-route ridership counting from paper Count Sheets keyed into Access over to OnBoard, ahead of Keolis starting on 2027-01-01. It is updated by the status session. Each line gives the time it was last checked.

**Last full verification:** 2026-11-04 19:15 CT (2026-11-05 01:15 UTC).

**Shareable page:** <https://claude.ai/artifact/W1dftDG7NaAs21uNrj1B19> (private; it is shared from the page's Share menu).

**Key:** 🟢 on track · 🟡 at risk, or open with time left · 🔴 blocking, or late.

**How it was checked:**
- PRs: with `gh pr view`.
- Deployed versions: from the console bundle on dev (Front Door) and on prod (`onboard.mvta.com/console`).
- Dev database: read only, with `sqlcmd`.
- Prod database: **not reachable from this session** (reading prod was refused). Prod lines marked *(last known)* come from the session that did the work.

---

## Next deadline

**Week of 2026-11-16: G1 print rehearsal at both garages, on prod.** It needs:
- the block-to-garage list for the current schedule
- Ridership Printer granted to the desk staff
- B2B guest accounts for the incumbent's desk staff

None of these is done yet. **Overall readiness for 7 December: 🟡 AMBER.** All the code that 7 December needs is live on prod. What is left is people and configuration (garages, grants, accounts, notice) and two small pieces of code (W1-3, W2-3).

---

## 1. Milestones

| Date | Milestone | Status | What has to be true | Verified |
|---|---|---|---|---|
| wk of 2026-11-16 | **G1** print rehearsal (prod, both garages) | 🟡 | Block list for the current schedule on prod, desk grants and guest accounts. None of them is done yet | 11-04 19:15 |
| 2026-11-23 | Incumbent's 14-day notice for 7 Dec | 🟡 | The notice text is in #463, which is still a draft. Nothing has been sent, and nothing goes without the user | 11-04 19:15 |
| **2026-11-29/30** | **G2 dry run**: a full next-day stack per garage, the morning reprint, and scanning to the folder | 🟡 | Needs G1, the MFP scan-to-folder route (IT), and W1-3 (the no-trips warning) | 11-04 19:15 |
| 2026-12-04 | **G3** go/no-go; print-path freeze from 12-02 to 12-08 | 🟡 | Block list for the 7 Dec schedule complete; scan folder set up | 11-04 19:15 |
| **2026-12-06 evening / 12-07** | **G4 Plan A start: OnBoard Count Sheets from the service change.** The incumbent keys Access only, plus scans | 🟡 | 7 Dec GTFS in the Dispatch Log by 03:30 on 12-06. Printing code is 🟢 (live on prod, 1.7.25) | 11-04 19:15 |
| 2026-12-09 → 12-18 | **G5** Keolis OCC keys scans in training (Keolis never keys Access) | 🟡 | Keolis guest accounts and `ridership-recorder`; W2-3 parallel marking (not built); pre-fill on prod confirmed | 11-04 19:15 |
| 2026-12-18 | **G6** conditional cutover notice | 🟡 | W2-2 trip-by-trip comparison (not built, needed by 12-14); W2-1 Access TripID rule; Q15 acceptance test | 11-04 19:15 |
| **2027-01-01** | **G7 Keolis starts**: OnBoard only, deadline and late states | 🟡 | W3-1 day type on save; W3-2 FixedTotals export (ServiceType unsettled) | 11-04 19:15 |
| 2027-01-08 | **G8** flags live and training | 🟡 | W3-3 flags (L, not started) | 11-04 19:15 |
| mid-Jan 2027 | **G9** December import with control totals | 🟡 | W3-6; needs the `FixedTotals` history export | 11-04 19:15 |
| 2027-01-29 | Month complete and close | 🟡 | W3-4 (L, not started; three to four weeks of slack) | 11-04 19:15 |
| **early Feb 2027** | **G10 Occurrences**: January close, candidates, report on 02-12 | 🟢 | W4-1 occurrence source; not started; on the plan | 11-04 19:15 |

Gate dates are from the completion plan (#492, draft).

---

## 2. Workstreams

### 2.1 Entry, schema and API (build Increment 1): 🟢 live
| PR | What | State | Version | Verified |
|---|---|---|---|---|
| #457 | Schema, roles (`ridership-recorder`, `ridership-manager`) | MERGED 8ae549b0 (11-01) | 1.6.50 | 11-04 19:15 |
| #465 | API: worklist, sheet read/save, block garages | MERGED b1e75dd2 (11-01) | 1.6.51 | 11-04 19:15 |
| #469 | Ridership page and Ridership setup | MERGED 6d7df4c1 (11-01) | 1.6.56 | 11-04 19:15 |

- **Deployed:** dev and prod console bundles both report **1.7.25** (11-04 19:15).
- **Migrations:**
  - Dev 🟢: 153 and 154 checked by their effect. Ridership tables, `TripStartLog.scheduled_end_seconds` and all three ridership roles are present (11-04 19:15).
  - Prod: applied 11-01 *(last known)*.
- **Use on dev:** one test sheet entered (11-01). No real entry yet.
- **Next:** none for 7 Dec.

### 2.2 Printing (the nightly desk print and morning reprint): 🟢 code live; 🟡 setup
| PR | What | State | Version | Verified |
|---|---|---|---|---|
| #474 | One PDF per garage, print log (migration 157) | MERGED 73045d52 | 1.6.70 | 11-04 19:15 |
| #476 | Guide trip names, AM/PM | MERGED 5bcf2663 | 1.6.72 | 11-04 19:15 |
| #485 | Morning reprint count | MERGED 1ea86899 | 1.7.6 | 11-04 19:15 |
| #478 | Bulk garage assign | MERGED c4672f8d | 1.7.7 | 11-04 19:15 |
| #482 | Unassigned-block warning | MERGED a4cf7158 | 1.7.8 | 11-04 19:15 |
| #483 | Ridership Printer role (migration 159) | MERGED f192ca74 | 1.7.9 | 11-04 19:15 |
| #484 | Avail trip number, e.g. 320-E | MERGED af1d3d91 | 1.7.10 | 11-04 19:15 |
| #489 | Printed trips per sheet (migration 161) | MERGED 9e406995 | 1.7.14 | 11-04 19:15 |
| #490 | Relief or bus-change line (migration 162) | MERGED 3714cd95 | 1.7.22 | 11-04 19:15 |

- **Deployed:** the "Ridership Printer", "Relief or bus change", "Unassigned" and reprint strings are all in the live dev and prod bundles (11-04 19:15).
- **Migrations:**
  - Dev 🟢: 157, 159, 161 and 162 present by their effect: print tables, `ridership-printer` role, `trip_ids` column, `CK_RidershipSheets_Change` (11-04 19:15).
  - Prod: applied *(last known, from the ridership-print session, 11-03)*.
- **Use on dev:** 6 print runs, the last on 11-03 13:51 UTC (11-04 19:15).
- **Next:**
  - W1-3: warn when the chosen date has no trips (not built).
  - W1-4: print-path freeze from 12-02 to 12-08.

### 2.3 Operator and bus pre-fill on prod (#493): 🟡
- **#493:** MERGED 61c053ee (11-04 19:50 UTC). Prod infra deploy run 41900876109 succeeded. A prod API and console deploy at cbf200a9 also succeeded at 11-05 00:59 UTC (11-04 19:15).
- **Not yet confirmed:** that prod's `FixedRouteDepartures` is filling. Two ways to check: prod Integrations & Data Health shows an Avail pull-out run, or a prod sheet opens with the operator and bus filled in.
- **Dev for comparison:** 161 departures per day; 11-04 last updated 16:55 UTC (11-04 19:15).
- **Next:** the user confirms on prod (§3 step 4).

### 2.4 December comparison and the Jan 1 features (completion plan): 🟡 not started
- **#492** (completion plan, with QA): OPEN, draft, docs only (11-04 19:15).

| Item | What | Status | Needed by |
|---|---|---|---|
| W1-1 | Pre-fill poll on prod | 🟢 done by #493 | — |
| W1-3 | No-trips readiness warning | 🟡 not built | G3, 12-04 |
| W2-1 | Access TripID rule. Day digit found 11-03 (1 Mon–Thu, 3 Fri, 2 Sat/Sun); the full check against the Access table is still open | 🟡 | before W2-2 |
| W2-2 | Per-trip export plus Access-upload diff | 🟡 not built | 12-14 |
| W2-3 | Mark December entries `parallel` | 🟡 not built; decision Q1 | 12-09 |
| W3-1 | Day type on save | 🟡 not built | 01-01 |
| W3-2 | FixedTotals export and trip × date grid | 🟡 not built; ServiceType unsettled | 01-01 |
| W3-3 | Flags | 🟡 not built | 01-08 |
| W3-4 | Month complete and close | 🟡 not built | 01-29 |
| W3-5 | Reporting API | 🟡 not built | G9 |
| W3-6 | History import with control totals | 🟡 not built | mid-Jan |
| W4-1 | Occurrence source | 🟢 not built; has slack | early Feb |

**Critical chain:** W2-3 → W2-2 → G6, then W3-1 → G7.

### 2.5 Spec and APC: 🟢 docs
- **#455** (spec, §12 APC comparison, §14 APC troubleshooting, §16 Access screens): OPEN, not draft, mergeable; head 269f8f62, last updated 11-03 (11-04 19:15). It is still not merged even though the build follows it.
- **#494** (APC health plan): MERGED cbf200a9 (11-04). The page is not built.
- **Next:**
  - Decide whether to merge #455.
  - The APC health build is not on the Dec/Jan critical path.

### 2.6 Contractor briefing and SOPs: 🟡
- **#486** (SOP drafts): MERGED 20a2dae5 (11-03) (11-04 19:15).
- **#463** (contractor briefing, the Dec 7 parallel run by scanning): OPEN, draft; head 711a61e5, updated 11-04 19:52 UTC. On 11-04 five SOP decisions moved to Decided on this branch: APC criteria, Attachment G, scope, who gives notices, and glossary (11-04 19:15).
- **Next:**
  - The incumbent notice by 11-23.
  - OPR-038 issuance.
  - Nothing is sent to contractors without the user.

### 2.7 Reporting: 🟡 spec
- **#475** (reporting spec): OPEN, draft (11-04 19:15).
- **Next:** the report review with Planning. It gates Power BI, not the Jan 1 export.

### 2.8 Operator app, kiosk and PIN sign-in: 🟢 design (after Jan)
- **#458** (operator app design): OPEN, not draft (11-04 19:15).
- **#461** (kiosk evaluation): OPEN, draft (11-04 19:15).
- **#462** (kiosk hardware): OPEN, draft (11-04 19:15).
- **#487** (logon ID + PIN): OPEN, draft (11-04 19:15).
- The ops-mobile-features session is idle, waiting on the user's review of a prototype in the shared notes folder.
- **Next:** none needed before Jan. Phone use needs the OPR-038 amendment first.

### 2.9 Scan upload: 🟢 off the critical path; 🟡 timing to settle
- **#488** (scan upload evaluation, `plans/count-sheet-scan-upload.md`): OPEN, draft; head 951de719, last updated 11-03. It has 0 review comments. No code is written (11-04 20:00).
- **Agreed 11-02** (8 decisions):
  - an upload page in the console for a batch PDF from the garage MFP;
  - the desk can upload but not view;
  - pages identified by their corner marks and QR code;
  - Document Intelligence Read/Layout only, with no Azure OpenAI;
  - low-confidence boxes left empty for OCC to type;
  - lateness stays on OCC's confirmation;
  - WORM storage, with views logged;
  - the scan proposed as the record copy.
- **Already done from it:** decision 8, the printed trip list per sheet (#489, migration 161), applied on dev and prod (11-04 20:00).
- **Timing decided by the user, 2026-11-04 20:15 CT: keep the December pilot.**
  - #488's decision 1 stands: a capture-only pilot at Burnsville (S1) from mid-December, with no reading.
  - It covers about 20 sheets a weekday.
  - Eagan stays on the shared scan folder for December.
- **Not yet in line with that decision:**
  - The completion plan (#492, W5-1) still puts the upload page in late January.
  - The contractor briefing (#463) puts December's scans in the shared folder.
  - Both documents need a line saying Burnsville uploads from mid-December.
- **S1 build:**
  - **Scope:** storage, the upload page, the queue worker (split, straighten, identify), Scanned / Not scanned on the worklist, and the scan beside OCC's form.
  - **Status:** 🟡 not started, and no session is building it.
  - **Timing:** it lands in the same weeks as G2–G6.
  - **Merging:** it must not touch the print path during the 12-02 to 12-08 freeze. Backend merges go outside 4am to midnight CT.
- **Steps outside the code before any build** (from #488):
  - MFP capabilities and who owns them (IT and Ops)
  - approve the new storage and Document Intelligence resources and their cost (user)
  - managed-identity role grants (user)
  - seed `ridership.scan` / `ridership.scans.view`
  - the retention period (records management)
  - data-protection sign-off (IT/security)
  - the SOP/OPR-038 wording (Planning and Ops)
  - training
- **Before mid-December:**
  - The Burnsville MFP survey (IT and Ops).
  - Your approval of the Azure resources and their cost.
  - The storage account and the managed-identity grants (you run the grants).
  - Seeding `ridership.scan` into the ridership roles.
  - Ridership Printer for the Burnsville desk.
  - A short SOP note for the Burnsville desk, plus about 30 minutes of desk training.
  - The retention period can follow: the container stays unlocked until it is set.
  - Data-protection sign-off is needed only before the reading trial (S2), not for capture.
- **Next:**
  - Start the S1 build.
  - Update #492 W5-1 and the #463 briefing.

### 2.10 Reconciliation review: 🟢 docs
- **#459:** OPEN, draft (11-04 19:15). Its findings feed Q4 (month complete) and Q15 (acceptance test).

---

## 3. Steps outside the code

| # | Step | Owner | Status | Verified |
|---|---|---|---|---|
| 1 | Grant **Ridership Printer** to each garage check-in desk person, on dev and prod | Access administrator (Access & Identity) | 🟡 Dev: **0 grants** of any ridership role. Prod: not verifiable from here. Needed for G1 (wk of 11-16) | 11-04 19:15 |
| 2 | Grant `ridership-recorder` to each Keolis OCC person, and `ridership-manager` to named Planning staff | Access administrator | 🟡 Dev: 0 grants. Recorder is needed by 12-09 (G5) | 11-04 19:15 |
| 3 | Entra B2B guest accounts: the incumbent's desk staff by 11-16; Keolis OCC and desks by 12-11 | MVTA IT | 🟡 not started, as far as known | 11-04 19:15 |
| 4 | Confirm the prod pull-out poll has filled prod's departures table (#493) | User (prod database or Data Health page) | 🟡 deployed, not confirmed | 11-04 19:15 |
| 5 | Block-to-garage list: the current schedule by 11-16 and the 7 Dec schedule by 12-04, on prod | Planning | 🔴 Dev: **0 of 144** blocks assigned. Prod: 180 blocks were Unassigned *(last known)*. An inferred split exists (Eagan 160 / Burnsville 20, from overnight parking) but has not been entered | 11-04 19:15 |
| 6 | Planning's questions: the Access Flag column; the day-type digits (1/3/2 found, to be confirmed against the Access table); and Vehtypgrp / MaxOfVariation / FirstOfTerm as a possible ServiceType source (Q15) | Planning | 🟡 open | 11-04 19:15 |
| 7 | `FixedTotals` history export from Access, for W3-6 and the control totals | Planning | 🟡 not received | 11-04 19:15 |
| 8 | OPR-038 issuance (ridership amendments), with the SOP code from the document registry | MVTA Operations / document owner | 🟡 drafts merged (#486); not issued | 11-04 19:15 |
| 9 | Contractor notices: the incumbent's by **11-23** (14 days); Keolis's conditional cutover notice on 12-18 | User / MVTA Operations | 🟡 drafted in #463; not sent | 11-04 19:15 |
| 10 | MFP scan-to-folder route and a restricted shared folder at each garage | MVTA IT | 🟡 needed by 12-04 (G2 uses it 11-29) | 11-04 19:15 |
| 11 | Check that the 7 Dec GTFS is loaded and in the Dispatch Log by 03:30 on 12-06 | Planning / engineering | 🟡 due 12-05 | 11-04 19:15 |
| 12 | Apply each new migration to dev, then prod, before its gate, and confirm the drift check is clean | User | 🟢 nothing pending today | 11-04 19:15 |
| 13 | Named engineering on-call for print nights (12-06 to 12-09, 01-01 to 01-02) | User | 🟡 decision Q5 | 11-04 19:15 |

---

## 4. Open decisions

| # | Decision | Who decides | Recommended in the plan | Verified |
|---|---|---|---|---|
| Q1 | What happens to Keolis's December OnBoard entries | User + Planning | Keep them marked `parallel`; Access is December's figure | 11-04 19:15 |
| Q2 | How rehearsal sheets are removed on prod | User | Logged manager-only discard, refused after cutover | 11-04 19:15 |
| Q3 | Access-upload diff, or an export only | User + Planning | Build the diff | 11-04 19:15 |
| Q4 | Month complete with sheets still missing | User + Planning | Allowed, with a reason per sheet | 11-04 19:15 |
| Q5 | Engineering cover on print nights | User | A named on-call | 11-04 19:15 |
| SOP 15 | What "accepts the result" means for the parallel run | Planning | No test written yet | 11-04 19:15 |
| SOP 6 | Whose staff "Contractor OCC staff" are | Operations | Contractor staff, with the recorder role | 11-04 19:15 |
| SOP 13 | Which contract number to cite | MVTA contracts | C-10235 for now | 11-04 19:15 |
| SOP 19 | Scan-and-upload as an entry method | Planning + engineering | Mentioned as a method MVTA may enable | 11-04 19:15 |
| SOP 1 | SOP code | Document registry | OPR-RID-00 placeholder | 11-04 19:15 |
| — | ServiceType source (L/MX/RC/SX/DX) for the totals export | Planning, then the user | Unsettled; the export leaves it blank | 11-04 19:15 |
| — | Whether to merge spec PR #455 and completion plan #492 | User | — | 11-04 19:15 |
| ✅ | Scan upload timing. **Decided 11-04 by the user:** keep #488's mid-December Burnsville capture pilot | User | — | 11-04 20:15 |

SOP decisions 5, 7, 11, 12 and 16 were moved to Decided on #463's branch on 11-04. The SOP agent asked the user to confirm them.

---

## 5. Risks

| Risk | Effect | Mitigation | Verified |
|---|---|---|---|
| The block-to-garage list is not entered on prod by 11-16 | G1 cannot print per garage; every sheet shows as Unassigned | Planning enters it; the bulk assign (1.7.7) makes it a few minutes' work; the inferred Eagan/Burnsville split is a starting point | 11-04 19:15 |
| Guest accounts and grants are late | Desk staff cannot print; Keolis cannot key from 12-09 | Start the IT request now; grants follow on the same day | 11-04 19:15 |
| The incumbent's notice misses 11-23 | The 7 Dec start slips, or starts without proper notice | The user sends it from #463's text | 11-04 19:15 |
| The 7 Dec GTFS is not loaded before 03:30 on 12-06 | The first live print is empty or wrong | W1-3 warning, and a manual check on 12-05 | 11-04 19:15 |
| W2-3 is not built before Keolis's first save on 12-09 | Training entries become a second set of December figures | Small item; build in the week of 11-09 | 11-04 19:15 |
| W2-2 comparison is late (needed 12-14) | No trip-by-trip basis for the 12-18 notice | On the critical chain; start the week of 11-16 | 11-04 19:15 |
| ServiceType source stays unsettled | The FixedTotals export ships with ServiceType blank on 01-01 | Planning answers Q15 | 11-04 19:15 |
| The Burnsville scan pilot (S1) competes for build time with W2-3 and W2-2 in December | The critical chain to the 12-18 notice slips, or the pilot starts late | The pilot is optional for the gates: if it squeezes W2-2, start it on 01-02, as #488 allows | 11-04 20:15 |
| Prod is not reachable from the status session | Prod lines rely on the last known state | The user confirms prod facts, or runs the read queries | 11-04 19:15 |
| Parallel sessions merge into main often | Version numbers race; a merge in the print-path freeze could break printing | Freeze 12-02 to 12-08 (W1-4); check every open PR's version | 11-04 19:15 |
| A REST deploy restarts the API during service hours | Brief outage on print nights | Merge backend changes outside 4am to midnight Central | 11-04 19:15 |

---

## Change log of this board

- **2026-11-04 19:15 CT:** first pass.
- **2026-11-04 20:00 CT:** added scan upload detail (#488): the agreed design, what is already built, the timing conflict with plan A, and its steps outside the code.
- **2026-11-04 20:15 CT:** the user decided to keep the mid-December Burnsville scan pilot. Recorded what it needs and the documents to bring into line.
