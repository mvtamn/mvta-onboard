# Evidence and detours review

Reviewed 2026-11-01 against main at `6eb60c7e` (v1.6.59). Evaluation only: nothing
here is built. The question throughout is whether a dispatcher or reviewer can
read a page and know what to conclude and what to do next, without knowing how
OnBoard works inside.

How it was looked at:

- the code named in each section;
- the live dev console (signed in, read only; nothing was clicked that writes);
- read-only queries on the dev database for the numbers quoted below;
- the glossary in `CONTEXT.md` ("Missed-trip language", "Dispatch Log language",
  "Detour and closure language"), ADR-0030 and ADR-0035/0036.

---

## 1. Missed-trip case evidence

### What the reviewer is looking at today

The case detail on Compliance → Missed Trips
(`routes/modules/MissedTripAlerts.tsx:880-1080`) shows, top to bottom:

1. a header pill (`lifecycleLabel`: "Potential missed", "Watching"...);
2. a "Grace deadline" hero time;
3. seven fact rows: Source, Where it stands, Evidence finding, Detection type,
   Evidence quality, Detector version, First flagged;
4. **Start evidence** (`startEvidenceFacts`, `missedTripReview.ts:404`): Started,
   Dispatch Log departure, Bus on this trip, Block, First stop;
5. the Investigation form: Reason, notes, Attribution, four outcome buttons.

Two real cases from the dev queue today, as the page shows them:

| | Route 442, 0802-EB, Nov 1 | Route 444, 1701-NB, Oct 31 |
|---|---|---|
| Evidence finding | Started more than 30 minutes late | No start observed by the deadline |
| Detection type | Scheduled no-show (never observed) | Scheduled no-show (never observed) |
| Started | 8:59 AM · 57 min late · past the 30 minutes | No start observed |
| Dispatch Log departure | Not a departure: only the schedule (8:02 AM) was repeated | Not recorded |
| Bus on this trip | Bus 4520 reported from 8:34 AM, under way 8:59 AM | No bus reported on this trip |
| Block | Block 515-v64: a bus reported on 2 of 7 trips | Block 556-v64: a bus reported on 7 of 8 trips |
| First stop | Burnsville Center · 3 of 6 other no-shows here turned out to have run | Burnsville Center · 4 of 6 other no-shows here turned out to have run |

### What works

- **The facts are the right facts.** Did it start, by which reading, was a bus
  there, was the block worked, is this a stop where buses go quiet: that is the
  order a reviewer reasons in, and each line comes from the same rule the
  detector used (`operatedStartAt`, `caseEvidence.ts:76`), so the page and the
  detector cannot disagree.
- **"Not a departure: ..." lines explain themselves.** `schedule_repeated`,
  `prediction_only` and `no_vehicle` each say *why* a logged time is not a
  start (`missedTripReview.ts:449-458`). This is the best-worded part of the
  page.
- **Lines with nothing to say are left out**, not shown as dashes.
- **The guards work.** Of the 160 unreviewed cases from the current silent
  no-show detector on dev, 119 closed themselves by evidence; 41 reached the
  queue. Of those, 29 have no start at all and 13 started past 30 minutes,
  which is the population a human should see.
- **The assessment line** ("Counted in 10/2026", "Held — sources disagree") tells
  the reviewer where the decision goes, in their words.

### What confuses

**C1. Nothing says what the evidence adds up to.** Every fact is neutral or
"warn", and the reviewer has to assemble the conclusion. Case 0802-EB is a
clean Confirmed missed trip (bus signed in 32 minutes after the scheduled start
and left the first stop 57 minutes late), but no line says so. Case 1701-NB
(no bus on the trip, but the block's bus reported on 7 of 8 trips) points the
other way, towards a bus that ran this trip without reporting, and that is not
said either. The page has a "Reason" dropdown and four outcome buttons, but no
"the evidence suggests" line tying them to the facts.

**C2. Four names for one detector, none of them the glossary's.** The same
thing is called:

| Where | Words |
|---|---|
| Case "Detection type" (`detectionTypeLabel`) | Scheduled no-show (never observed) |
| Case "Evidence finding" (`findingLabel`) | No start observed by the deadline |
| Detectors admin and scorecard (`detectorPromotion.ts:20`) | Silent no-shows |
| Monthly table (`MissedTripAlerts.tsx:1132`) | No-shows |
| Glossary | Suspected no-show |

The cancellation detector has the same problem: "Explicit cancellation
(GTFS-RT)", "Cancelled by dispatch", "Advance cancellations", "Cancellations".
"Scheduled no-show (never observed)" is also **false** on 0802-EB, which was
observed (it started 57 minutes late). The label describes why the case was
raised, but it reads as a description of the trip.

**C3. Internal words on the case.**

- *Grace deadline* (hero metric) – the glossary has no "grace"; it is the
  30-minute deadline.
- *Source: GTFS / GTFS-RT*, *Detector version: gtfs-silent-v4*,
  *Evidence quality: Experimental detector* – three rows that matter to an
  engineer, not to someone deciding the case. "Experimental detector" is the
  console's name for **Shadow detection**; the glossary and the Detectors page
  say Shadow detection.
- *under way* / *never shown under way* – the glossary term is **First observed
  progress**. A dispatcher reads "under way" as "the bus was moving", but the
  rule means "passed the trip's first stop". A bus moving to its first stop is
  "under way" to a dispatcher and not to OnBoard.
- *Not recorded from the trip update* (`position_fallback`) – "trip update" is a
  GTFS-realtime message type.
- *Ref t322-b203-sl1B-v64* – useful to support staff; fine to keep, but small.

**C4. The Block line shows the GTFS form, which the glossary forbids.**
"Block 515-v64" is the versioned GTFS id. The glossary ("Block") says the Block
is the three-digit workbook number (`515`) and `1-v64` style is *not* the Block.
The Dispatch Log already converts it on read (v1.5.312); the case evidence
does not.

**C5. The Block line gives a count, not the answer.** "A bus reported on 7 of
8 trips" leaves the reviewer to wonder whether the bus worked the trips just
before and after this one, which is the question that settles it. The detector
already has a held reason for exactly that (`block_ran_around_this_trip`,
"The block's bus was working around this trip"); the case line does not name
the neighbouring trips, their times or the bus.

**C6. The First stop line only speaks above the bar.** "4 of 6 other no-shows
here turned out to have run" is shown with no tone and no note because 67% is
under the 80% bar. A reviewer cannot tell whether 4 of 6 is a lot. Above the
bar it says "Likely GPS dead zone" but in **warn** (amber) tone, which is the
same tone "No start observed" uses. On this page amber means "against the
contractor" in one line and "be careful, the data is weak here" in the next.

**C7. Shadow detection is mentioned but not stated.** Every case reads
"Confirming adds this to the 10/2026 performance assessment as a charged
occurrence, once its detector is out of Shadow detection." No detector is out of
Shadow detection on dev, so the honest sentence is "This detector is in Shadow
detection: confirming records the outcome, and nothing is charged". As written
the reviewer is told to imagine a condition rather than told the fact.

**C8. "False positive" is back in two places the glossary retired it.** The
summary stat is "False positives" (`MissedTripAlerts.tsx:574`), and the reason
list offers "Detection error (false positive)" (seeded by
`functions-restapi/sql/migration-023-missed-trips-detection-and-reasons.sql`).
The outcome itself is called Timely service everywhere else since migration 125.
The reason list is also not tied to the outcome: "Operator no-show" can be
saved with Timely service, and "Detection error" with Confirmed missed trip.

**C9. Two pills say the same thing differently.** The header pill says
"Potential missed"; the Investigation pill says "Unreviewed"; "Where it stands"
repeats "Potential missed". The list row shows "Potential missed" and
"Unreviewed" side by side. The glossary's lifecycle name is *Ready for review*.

**C10. The "legacy candidates" note is written for the people who built the
detector.** "4,762 legacy candidates from the superseded detector are excluded
from this queue. Their outcome is unknown rather than false — the evidence
needed to decide them was never recorded..." The reviewer needs: these are not
waiting for you.

### What is missing or unhelpful

- **M1. No link to the evidence's own pages.** The Dispatch Log row for this
  trip (time, Block, operator from the workbook) is one click away in another
  module, but the case does not link to it. Nor to the bus's track.
- **M2. No Avail line for GTFS cases.** ADR-0035 links Avail evidence to cases
  (corroborated / conflict / probable), and the scorecard counts it, but the
  case's Start evidence does not show "Avail: whole miss recorded / not
  recorded / probable match waiting for you". The probable links that need a
  reviewer's confirmation (16 + 50 on the scorecard) have nowhere visible on
  the case to be confirmed.
- **M3. Bus sign-in is not related to the schedule.** "Bus 4520 reported from
  8:34 AM" is the strongest late-pull-out evidence on case 0802-EB, but only
  if you subtract 8:02 yourself. "32 min after the scheduled start" would say it.
- **M4. No outcome is suggested from the evidence.** See C1. The four
  combinations that settle most cases are known:
  started past 30 → Confirmed missed trip (late start);
  no bus on trip and no bus on block → Confirmed missed trip (block not run) or
  a Data coverage gap;
  no bus on trip but block's bus ran the trips either side → likely Timely
  service at a dead zone;
  started inside 30 → should already be Closed by evidence.

### The case header, for both sources

The fact list above the Start evidence (`MissedTripAlerts.tsx:915-929`) is the
same seven rows for a fixed-route case and an on-demand (Spare) case. Two worked
examples the user sent, checked against the code and dev data:

**Fixed-route example.** It shows Source GTFS / GTFS-RT · Potential missed ·
No start observed by the deadline · Scheduled no-show (never observed) ·
Experimental detector · gtfs-silent-v4 · First flagged 3:20 PM.

| Problem | Verified? | Where it comes from |
|---|---|---|
| "Evidence finding" and "Detection type" repeat each other | Yes. The two rows come from different fields (`findingLabel` on the classified finding, `detectionTypeLabel` on the stored `detection_type`), and on a silent no-show both say "no start". When they differ, as on 0802-EB, they contradict each other (see C2). | `missedTripReview.ts:63`, `:229` |
| No scheduled start, deadline, route, trip or block in the facts | Partly. Scheduled departure and "Grace deadline" are in the hero box *above* the rows, and route and trip are in the heading. The Block appears only in Start evidence, in the GTFS form. "First flagged" sits five rows away from the scheduled time it should be compared with. | `:888-912` |
| "Experimental detector" reads as "don't trust this case" | Yes. It is `data_quality_status = 'experimental'`, which the detector stamps on every silent no-show while it is in Shadow detection. It says nothing about this case's evidence. | `dataQualityLabel`, `missedTripReview.ts:239` |
| "(never observed)" — observed by what? | Yes. It is the detector's own description, meaning no position past the first stop and no realised Dispatch Log departure by the deadline. It is shown even when the trip *was* later observed. | `missedTripReview.ts:229` |
| Detector version is internal | Yes | `:921` |
| Does Start evidence appear below? | Yes for every GTFS case: the API reads it for each non-Spare case on the page (`reads.ts:248`). It is missing only when that read **fails**. The server then logs the error (`functions/missedTrips.ts:39`) and the console silently falls back to "First underway evidence: Not observed", which looks like evidence of absence. | `MissedTripAlerts.tsx:924-929` |

**On-demand (Spare) example.** This is dev request `bfcba9fa`, Oct 29. It
shows Spare Requests + Slots · Potential missed · On-demand service failure ·
Spare dropoff arrived at least 30 minutes late · Source verified ·
spare-missed-v2 · First flagged 5:22 PM · Pickup arrival evidence 4:25 PM.

| Problem | Verified? | Where it comes from |
|---|---|---|
| The rule is about the dropoff, but the only time shown is the pickup arrival | Yes. "Pickup arrival evidence" is `detected_late_arrival_at`, which the Spare adapter fills with `pickup_arrived_at` for every Spare detection type (`adapters/spare.ts:72`). The dropoff appears only as a lateness figure ("Dropoff lateness 32 min") in the Spare evidence block below, and the hero box shows a "Grace deadline" of **pickup** + 30 min (`spare.ts:65`), which has nothing to do with a late-dropoff rule. | `MissedTripAlerts.tsx:926`, `:956-957` |
| First flagged 5:22 PM, an hour after the 4:25 PM pickup, with no reason given | Yes, and the reason is harmless. Spare is evaluated retrospectively, once a request has completed (`spare.ts:6-8`). This ride's dropoff was at 5:15 PM, so it was flagged 7 minutes after the ride ended. Nothing says so. | `spare.ts` header |
| "Potential missed" beside "On-demand service failure" reads as two verdicts | Yes. One is the lifecycle (`ready_for_review` → "Potential missed") and the other is the evidence finding. Neither is a verdict, but both are worded like one. | `lifecycleLabel`, `findingLabel` |
| "Source verified" sounds like the case is confirmed | Yes. `data_quality_status = 'source_verified'` means the detection came from source records rather than inference. It is not a review. | `dataQualityLabel` |
| Detector version is internal | Yes | — |
| Is a late dropoff a "missed trip"? | **Contractually yes, by name no.** The glossary's *Late-arrival failure* is distinct from a missed trip "unless the governing agreement explicitly equates them. The on-demand agreement does" (`CONTEXT.md`, Late-arrival failure). So counting it is right, but the case should name it a **late dropoff (counts as a missed trip under the on-demand agreement)**, not leave the reviewer to wonder why a ride that happened is "missed". | `CONTEXT.md:1204` |

**The Spare times do not reconcile, and this needs an answer before any
relabelling.** `SpareMissedTripSource` holds every time a reviewer needs:
original and current scheduled pickup, original and current scheduled dropoff,
and actual pickup and dropoff arrival. None of them are shown. For this ride:

| | Pickup | Dropoff |
|---|---|---|
| Originally scheduled (promised at booking) | 4:00 PM | 4:14 PM |
| Scheduled at the end (after Spare re-planned) | 4:28 PM | 5:16 PM |
| Actual arrival | 4:25 PM | 5:15 PM |
| Spare's lateness figure | — | 1,903 s (31.7 min) |

The dropoff came 41 seconds *before* its final scheduled time and 61 minutes
after its original one. Spare's 31.7 minutes matches neither, so the reviewer
cannot check the number that opened the case. The other three late-dropoff
cases on dev behave the same way. Before choosing labels, someone needs to
establish what Spare measures `dropoff_lateness_seconds` against (for example
a promised window end). That is a question for the Spare data owner, not a
code change.

**Proposed header, one shape for both sources:** what was scheduled → what we
saw → what it looks like → how sure. The source, detector and reference go
behind a "Technical details" fold.

```
Route 444 · Trip 1701-NB · Oct 31                         Ready for review
──────────────────────────────────────────────────────────────────────────
Scheduled    Leave Burnsville Center 5:01 PM · Block 556
             30-minute deadline 5:31 PM
What we saw  No departure in the Dispatch Log. No bus reported on this
             trip. Block 556's bus reported on 7 of its 8 trips.
Looks like   No start seen — but the block's bus was working, so it may
             have run without reporting.  Check before confirming.
Counting     Suspected no-show detector is in Shadow detection:
             a confirmation is recorded, not charged.
▸ Technical details   GTFS-realtime · gtfs-silent-v4 · flagged 5:35 PM
                      (4 min after the deadline) · Ref t6A5-b22C-sl1B-v64
```

```
MVTA Connect · Request bfcba9fa · Oct 29                  Ready for review
──────────────────────────────────────────────────────────────────────────
Booked       Pickup 4:00 PM, moved to 4:28 PM
             Dropoff 4:14 PM, moved to 5:16 PM
What we saw  Picked up 4:25 PM · dropped off 5:15 PM
             Spare reports the dropoff 32 min late
Looks like   Late dropoff (30 min or more). Under the on-demand agreement
             this counts as a missed trip.
             ⚠ 32 min doesn't match the times above — check in Spare.
Counting     On-demand detector is in Shadow detection:
             a confirmation is recorded, not charged.
▸ Technical details   Spare requests + slots · spare-missed-v2 · flagged
                      5:22 PM (7 min after dropoff; Spare rides are checked
                      once they end) · source records, not inferred
```

The "Looks like" line is the conclusion C1 asks for. On a fixed-route case it
leads with the Start evidence's verdict, and the Start evidence list stays
below as the reasons.

### The GPS dead zones panel (Admin → Missed-trip Detectors)

Works: the preview of which stops a bar change would add or drop
(`DeadZoneBarPanel.tsx`) is the right idea, and the live table is plausible:
Savage Park & Ride 49 of 52 ran, Gateway Ramp 11 of 11, MSP Terminal 1 11 of 12.

Confuses:

- "The bar is at its default and cannot be changed until migration 155 is
  applied." – a migration number in user copy. Say "Ask an administrator to
  enable changes" (and apply 155: it is still unapplied on dev, the
  `AppSettings` rows are absent).
- *Judged cases*, *Share that ran*, *Fewest cases*, *Save bar* – "judged" is the
  code's word. A reviewer would say "no-shows we could check", "ran", "minimum
  no-shows", "Save".
- The counts are all-time with no date range shown; a stop fixed by a new
  antenna will keep its flag for months.
- The stop names do not link to their cases.
- Percentages are truncated, not rounded (17 of 24 shows 70%, 4 of 6 shows 66%).
- It sits under *Administration → Standards & Contracts*, where reviewers do
  not go. The list is reviewer information; only the bar is an admin setting.

### The detector scorecard ("Ready to promote?")

Works: verdict first, one row per detector, the weekly strip against the 95%
line.

Confuses:

- **It is empty, and it does not say why.** For Silent no-shows it shows
  "Week of September 7, 2026 · 0 decisive", "No case was reviewed to a
  decision this week", "Held · indeterminate 0 · 0", "— of 0 detected",
  "Review burden 0 reviewed · 0 waiting" while the queue holds 73 unreviewed
  cases. Outside the retired legacy set, only 3 silent no-show cases on dev
  have ever been confirmed and none reviewed as Timely service. A detector
  cannot leave Shadow detection without reviews, and the page does not connect
  "nobody is reviewing" to "nothing can be promoted".
- **A backlog silently moves the verdict back in time.** A week counts as
  complete only when it has ended *and nothing in it is waiting for review*
  (`scorecard.ts:218`), and the row features the newest complete week
  (`featuredWeek`, `detectorScorecard.ts:97`). Every week since September 7
  has unreviewed silent no-shows, so the verdict reads "Week of September 7"
  while the cancellations row reads October 19. The page should say "8 weeks
  are waiting on N reviews" instead.
- *decisive*, *Recall*, *corroborated*, *unmatched*, *probable*: statistics
  words. "Recall None not observed" is a broken sentence (the
  `dispatcherRecallText` zero case, `detectorScorecard.ts:59`).
- "This database has no Avail evidence links (migration 136)" – migration
  number in user copy again.

### The Missed Trips queue

- The stat row says "False positives" (see C8).
- The deadline time in the list ("8:32 AM · 51 min ago") has no label; it reads
  as the trip's time.
- "Aging" and "Overdue" are good, but nothing on the page says what the review
  deadline is (24 h / 72 h) or why it matters (the assessment month closes).

(The OTP *Review Queue* on OTP Compliance is a separate page about flagged
stops, not missed trips. It was reviewed in PR #413 and is not covered here.)

### Labels: missed-trip area

| Where | Current | Proposed | Why |
|---|---|---|---|
| Case hero | Grace deadline | 30-minute deadline | The glossary rule is "30 minutes"; "grace" is a code word |
| Case facts | Detection type: Scheduled no-show (never observed) | Raised because: No start seen by the deadline | Says why the case exists without claiming the trip was never seen |
| Case facts | Evidence quality: Experimental detector | Detector: In Shadow detection (not charged) | Use the glossary term the Detectors page uses, and say the consequence |
| Case facts | Source: GTFS / GTFS-RT; Detector version | Move under a "Technical details" fold | Not decision information |
| Case pill / Where it stands | Potential missed | Ready for review | Glossary lifecycle name; drop the second pill ("Unreviewed") from the header |
| Start evidence | under way 8:59 AM | passed the first stop 8:59 AM | "Under way" means moving to a dispatcher; the rule means past the first stop (First observed progress) |
| Start evidence | never shown under way | never seen past the first stop | Same |
| Start evidence | Bus 4520 reported from 8:34 AM | Bus 4520 signed in 8:34 AM (32 min after scheduled start) | Relates it to the schedule, the reason it matters |
| Start evidence | Not recorded from the trip update | The Dispatch Log time came from bus positions, not the departure feed | "Trip update" is a GTFS message type |
| Start evidence | Block 515-v64 | Block 515 | Glossary: the Block is the workbook number |
| Start evidence | a bus reported on 7 of 8 trips | e.g. "Bus 4521 ran the trips before (4:12 PM) and after (6:05 PM) this one" (illustrative) | Answers the question the count only raises |
| Start evidence | First stop · 4 of 6 other no-shows here turned out to have run | First stop Burnsville Center · 4 of the 6 other no-shows here ran (67%; dead-zone mark at 80%) | Gives the reviewer the scale |
| Start evidence | Likely GPS dead zone (amber) | Likely GPS dead zone (neutral / blue) | Amber means "against the contractor" elsewhere on the same panel |
| Confirm help | ...once its detector is out of Shadow detection | This detector is in Shadow detection: confirming records the outcome, nothing is charged | State the fact, not the condition |
| Stat row | False positives | Timely service | Glossary avoids "false positive" |
| Reason code | Detection error (false positive) | Detection error — the trip ran | Same; data change in the reason-code table |
| Legacy note | 4,762 legacy candidates from the superseded detector are excluded... | 4,762 older cases from the retired detector are kept for audit and are not waiting for review | What the reviewer needs to know |
| Detectors page | Silent no-shows | Suspected no-shows | Glossary term; and use it on the case and the monthly table too |
| Detectors page | Advance cancellations / Explicit cancellation (GTFS-RT) / Cancelled by dispatch | Cancelled trips | One name in four places |
| Spare case | Pickup arrival evidence | Picked up / Dropped off (both times), with promised and final scheduled times | The rule is about the dropoff |
| Spare case | Grace deadline (pickup + 30) | (remove for late-dropoff cases) | Not the rule being applied |
| Spare case | Detection type: Spare dropoff arrived at least 30 minutes late | Raised because: Late dropoff (30 min or more) — counts as a missed trip under the on-demand agreement | Names the glossary's Late-arrival failure and why it counts |
| Spare case | Evidence finding: On-demand service failure | (fold into "Looks like") | A second verdict-shaped label |
| Spare case | Evidence quality: Source verified | Technical details: from Spare's records (not inferred) | Reads as "confirmed" |
| Both | Detector version | Technical details fold | Internal |
| Both | First flagged 5:22 PM | Flagged 5:22 PM (7 min after dropoff) / (4 min after the deadline) | Gives the time its reference point |
| Dead-zone panel | Judged cases | No-shows we could check | "Judged" is the code's word |
| Dead-zone panel | Share that ran / Fewest cases / Save bar | Ran at least (%) / Minimum no-shows / Save | Plain words |
| Dead-zone panel | ...until migration 155 is applied | Changes are turned off on this database; ask an administrator | No migration numbers in user copy |
| Scorecard | 0 decisive | 0 reviewed to a decision | "Decisive" is a statistics word |
| Scorecard | Recall None not observed | Dispatchers flagged no missed trips this week | Broken sentence |
| Scorecard | Recall 0.0% · 32 unmatched · 50 probable | Avail whole misses: none matched to a case, 32 with no case, 50 possible matches waiting for a reviewer | Says what to do |

**Glossary changes proposed** (`CONTEXT.md`, Missed-trip language):

- add **Likely GPS dead zone**: a first stop where most checkable Suspected
  no-shows turned out to have run; a reviewer's note, never a decision;
- add **Dispatch Log departure** with its readings (departed, schedule repeated,
  prediction only, no bus on the trip, from positions, not recorded);
- add *underway* and *grace* to the *Avoid* list of First observed progress and
  of the 30-minute deadline respectively;
- add *experimental detector* to the *Avoid* list of Shadow detection.

---

## 2. Detours

Pages: Detours & Closures (`routes/Detours.tsx`, the worklist plus an expanded
row for detail, communications and history), Detour Intake
(`routes/DetourIntake.tsx`: the form and the OCC review queue on one page),
Detour Register (`routes/DetourReports.tsx`, read only). The server's workflow
is `functions-restapi/src/lib/detourWorkflow/decide.ts` (ADR-0030) and
`lib/detourCommunication/`.

On dev today there are five active detours. Three of them carry "Conflict
needs override", two show the owner as a raw sign-in address, three are
Unassigned. The intake queue holds 0 pending and 2 decided reports.

### What works

- **The rules live on the server.** The console reads `available_acts` and
  shows a held act with its reason instead of hiding it (`lib/detourActs.ts`).
  Most server refusals are plain sentences that say what to fix
  (`decide.ts:151`, `:155`, `eligibility.ts:15-17`).
- **The intake form** has a readiness rail with links to missing fields, and
  it holds back validation styling until the first submit
  (`DetourIntake.tsx:128-149`).
- **Likely duplicates** say why the records match and offer "Mark duplicate of
  this" in one click (`DetourIntake.tsx:493-505`).
- **"Managed in: Avail / Outside Avail / Not decided"** is the clearest label on
  the worklist (`lib/detourLabels.ts:87-102`).
- **The Register's empty states** are specific and offer an action.

### What confuses

**D1. Raw values reach the user.**

- "Record Avail result" asks the user to *type* "entered, conflict, or
  not_entered" (`Detours.tsx:355`). A typo does nothing, with no message
  (`:356`).
- Message rows render `{audience} · {channel}: {status}` raw: `sms`,
  `avl_messaging`, `draft` (`Detours.tsx:1021`). The server already has proper
  channel names (`detourCommunication/channels.ts`).
- Other statuses go through `replace(/_/g, " ")` and come out as "awaiting
  fulfillment" or "pending review" (`Detours.tsx:711`, `DetourIntake.tsx:500`).
- Some sentences leak enums or migration numbers: "Human Avail entry result:
  not_entered" in the history (`decide.ts:166`), and "Server-side delivery is
  not configured (migration 092)" (`detourCommunication/index.ts:115`).
- Every 400 shows only "Validation failed". `ApiError` carries the field
  details, but no detour page shows them (`shared/src/api.ts:882`).

**D2. "Conflict" means two things, and sometimes it appears in the same cell.**

- "Resolve the Avail conflict" means Avail refused the entry
  (`detourLabels.ts:21`).
- "Conflict needs override" means this detour overlaps another one, which the
  glossary calls a Conflict override (`:40`).
- The communication refusal calls the overlap "a likely duplicate"
  (`eligibility.ts:18`), but Likely duplicate is the glossary's *intake* term.

**D3. "Fulfilled" says the opposite of what happened for manual detours.**

- A manual detour starts as `fulfilled` (`decide.ts:86-88`).
- "+ New Detour" always creates a fixed-route manual detour
  (`detoursCreate.ts:150`).
- So "Workflow: Fulfilled" means "nothing has been done yet" on most
  directly created records.
- "Fulfillment" in general (Proposed fulfillment, Fulfillment path, Use manual
  fulfillment, Awaiting fulfillment) is a glossary word that no dispatcher
  says.

**D4. Temporal status and workflow state blur.**

- The green "Active" pill shows on detours still waiting for Avail entry, on
  closed detours whose end date is in the future (`detourStatus.ts:73-86`
  ignores `lifecycle_state`), and on records with no start date.
- "Next action" ignores dates. An expired Avail detour still says "In Avail;
  close it when the detour ends" (`decide.ts:261-273`).
- "Today" is computed in UTC (`detourStatus.ts:61-64`). After about 7 PM
  Central, a detour ending today already reads "Recently finished".

**D5. Avail rows contradict themselves on the worklist.** Detours 0002 and 0003
show "Managed in: Avail · Entry not recorded" and, in the next column, "In
Avail; close it when the detour ends".

**D6. The intake page calls an intake the Detour.**

- The page says "Create the complete operational Detour once" and "This same
  record becomes the authoritative Detour" (`DetourIntake.tsx:232`, `:449`;
  nav subtitle `App.tsx:87`).
- The glossary, ADR-0003 and ADR-0030 keep an intake separate; approval is its
  promotion.
- The Detour form's "Approved by / Approved at" fields
  (`Detours.tsx:568-576`) contradict the same rule.

**D7. One mode, many names.**

| Where | Fixed-route manual | Mobility manual | Avail |
|---|---|---|---|
| Intake form (`DetourIntake.tsx:10-12`) | Manual fixed-route exception | Manual mobility communication | Enter in Avail |
| Worklist labels (`detourLabels.ts:11-12`) | Fixed-route manual | Mobility manual | — |
| Detail button (`Detours.tsx:739`) | Use fixed-route manual exception | — | — |
| Glossary | Fixed-route manual Detour, manual fallback | Mobility manual Detour | Avail-backed |

"Clone" is the glossary's *Detour re-establishment* but never says so.

**D8. Smaller ones.**

- *Readiness* means form completeness on intake and next step on the Register.
- *Pending* is a time-window status ("Pending" / "Pending confirmation") right
  next to the queue state "Pending OCC review".
- *Someone else* is a button label.
- *Avail number* is a free-text field whose example is "Operator Message".
- The intake help says "radio and the dispatch board are recorded when done",
  but neither is offered as a channel any more (`DetourIntake.tsx:401`).
- The Register shows "460 South; 460 South" (a repeated route) on 0002.
- The worklist's intro line ("replaces the hand-tracked mix of Avail, staff
  email, and an Excel tracker") is project pitch, not guidance.
- "Delete" sits on every active row beside Edit and Clone.

### Dead ends and missing next steps

1. **An SMS draft offers "Send email".** The console counts SMS as sendable
   (`detourCommunicationDraft.ts:187`) and labels the button "Send email"
   (`Detours.tsx:1040`). The server has no SMS sender and refuses it with a 409
   (`detourCommunication/index.ts:136`).
2. **"Record AVL messaging went out" stays enabled when the server will
   refuse it.** `blocked` is cleared for recorded channels
   (`detourCommunicationDraft.ts:195`), but the server still applies the
   re-review, fulfillment and conflict rules to them (`eligibility.ts:43-51`).
   The user learns this only after clicking.
3. **Accepting an intake with no fulfillment mode fails with no fix in place.**
   The error is "Choose a valid fulfillment path", and the accept modal has no
   chooser for it (`DetourIntake.tsx:206`).
4. **After acceptance the new Detour is hard to find.**
   - The Decided row shows "Detour {GUID}" with no link.
   - The worklist opens on Active, so a future-dated detour sits under
     Upcoming.
   - The tabs show no counts, and the empty state is just "No detours in this
     view."
5. **Submitting a new intake gives no confirmation**: the form just resets
   (`DetourIntake.tsx:181-185`). Nobody is notified either. OCC sees only a nav
   badge, and a reporter whose intake is returned for information hears nothing
   (`hooks/usePendingIntake.ts:3-5`).
6. **Marking a duplicate can mean pasting a GUID** (`DetourIntake.tsx:486`).
7. **Ownership.**
   - Only promotion sets an owner, so direct and Avail-synced detours start
     Unassigned.
   - The owner is free text, and "Assign to me" compares it with the sign-in
     name. On dev, "Assign to me" is offered on detours already owned by the
     signed-in user.
8. **Re-review never says what changed.** The reason is always "Material
   operational details changed; OCC review required" (`decide.ts:65`), and the
   person who made the edit can clear it straight away.
9. **Clone drops most of the record**: location, instructions, audiences,
   channels, geometry, time window and service impact (`Detours.tsx:150-178`).
   Intake-only fields cannot be edited after acceptance at all.
10. **Close is final and doesn't say so.** It is one reason prompt, allowed from
    any open state including while waiting for Avail. There is no reopen, and
    the prompt does not point to Clone.
11. **"Needs communication" can never clear on a detour with no required
    audiences** (`eligibility.ts:66-69`).
12. **The Register has no link from a row to the Detour** it describes.
13. **The reporter can decide their own intake.** Reporting and deciding share
    one access action, `detours.intake` (`functions/detourIntake.ts:41`,
    `:384`).

### Labels: detours

| Where | Current | Proposed | Why |
|---|---|---|---|
| Detail | "Enter entered, conflict, or not_entered." (typed) | Three buttons: Built in Avail / Avail refused it / Not built yet | Raw enum; typos fail silently |
| Detail | Record human Avail entry | Record Avail result | "Human" is internal |
| Detail | Use fixed-route manual exception / Use manual fulfillment | Run it manually instead | Plain words; "manual fallback" stays the glossary act |
| Next action | Resolve the Avail conflict | Avail refused it — retry or run it manually | Frees "conflict" for overlaps |
| Next action | Conflict needs override | Overlaps another detour — override needed | Names the glossary's Conflict override |
| Comms refusal | A likely duplicate of this Detour is unresolved | This detour overlaps another open detour; record an override first | Likely duplicate is an intake term |
| Workflow state | Awaiting fulfillment | Waiting for Avail entry | Only Avail detours can be in it |
| Workflow state | Fulfilled | Built in Avail (Avail) / Running manually (manual) | "Fulfilled" before anything happened |
| Workflow state | Fulfillment failed | Avail entry failed | Only an Avail result causes it |
| Worklist | Avail · Entry not recorded + "In Avail; close it when..." | Avail · not yet built + "Record the Avail result" | The two columns contradict |
| Flag | Needs OCC re-review | Changed since OCC review: dates, segments (names the fields) | Says what to re-check |
| History | Fulfillment confirmed (also logged for failures) | Avail result recorded | True for every result |
| History | Correction (for assign, override, re-review) | Owner changed / Overlap overridden / Re-review done | One word for four acts |
| Comms | Ready / published | All audiences told | "Ready" implies eligibility |
| Comms | Needs communication (no audiences) | No audiences named | Otherwise it never clears |
| Comms | `sms · draft` | Text message · Draft | Raw values |
| Intake | Proposed fulfillment / Fulfillment path | How it will be run | Plain words |
| Intake | Manual fixed-route exception / Manual mobility communication / Enter in Avail | Fixed route, run manually / Mobility, run manually / Build in Avail | One name per mode, everywhere |
| Intake | Create the complete operational Detour once | Report a closure or detour for OCC review | An intake is not the Detour |
| Intake | Pending / Estimated / Confirmed (window) | Times unconfirmed / estimated / confirmed | Clashes with "Pending OCC review" |
| Intake | Readiness | Required facts | Clashes with the Register's Readiness |
| Detour form | Approved by / Approved at | External sign-off (e.g. city permit) | Approval is promotion (ADR-0030) |
| Register | Avail number | Number or label | It is free text |
| Register | Readiness & owner | Next action & owner | Same column as the worklist, same name |
| Worklist | Clone | Re-establish as new detour | Glossary term |
| Worklist | Someone else | Assign to… | Unclear |
| Worklist | Owner as a raw sign-in address | Display name | Readable |

**Glossary changes proposed** (Detour and closure language): give *Fulfillment
mode* and *Workflow state* display labels, i.e. the words above, so that the
glossary terms stay the precise ones and the screens use the plain ones. Add
*Clone* to the *Avoid* list of Detour re-establishment.

---

## 3. Ranked improvements

**Status, 2026-11-06.** Items 1–6 shipped on 2026-11-01: the missed-trip items
(1, 2, 4, 6) in #472 (1.6.66) and the detour items (3, 5) in #473 (1.6.67).
Item 4's label rename is migration 156, applied on dev 2026-11-04. Item 13's
migration 155 has since been applied on dev and prod, so the dead-zone bar can
be saved; only the panel's wording, window and links are left. Item 7 (the
Spare lateness baseline) is still open with the Spare data owner. Items 8–19
are not started. The missed-trip items that bear on making OnBoard the system
of record (7, 8 and 12) are carried into
`docs/handoffs/missed-trips-system-of-record-status-2026-11-06.md`.

Ranked by how much each removes a wrong conclusion or a dead end, against its
size. S is under a day, M is one to three days, and L is larger. "Migration"
means a SQL schema or data change.

| # | Change | Area | Size | Migration |
|---|---|---|---|---|
| 1 | **One case header for both sources**: scheduled → what we saw → looks like → counting, with source, detector, version and reference folded away. Spare cases show the promised, final-scheduled and actual pickup and dropoff (all already in `SpareMissedTripSource`) and drop the pickup-based deadline. | Missed trips | M | No |
| 2 | **"Looks like" line from the evidence** (C1/M4): late start, block not run, likely ran unreported (dead zone or block's bus working either side), and data gap. Display only; it never decides. | Missed trips | M | No |
| 3 | **Detour dead-end fixes**: Avail result as three buttons; no "Send email" on SMS; disable recorded channels the server will refuse, with the reason; show field errors instead of "Validation failed". | Detours | S | No |
| 4 | **Missed-trip label pass**: one name per detector (the glossary's), "Ready for review", "30-minute deadline", "passed the first stop", Block `515` not `515-v64`, Shadow detection stated as a fact, "Timely service" instead of "False positives", and the legacy note rewritten. | Missed trips | S | Small data migration only to rename the "Detection error (false positive)" reason label |
| 5 | **Detour label pass**: split the two meanings of "conflict", replace "fulfil-" words, one name per mode, raw enums through label maps, intake copy no longer calls itself the Detour. Glossary display labels added. | Detours | M | No |
| 6 | **Scorecard says what blocks it**: "8 weeks waiting on N reviews" when the backlog holds the verdict back; fix "Recall None not observed"; remove migration numbers from copy. | Missed trips | S | No |
| 7 | **Settle the Spare lateness baseline** with the Spare data owner before #1 shows a minutes-late figure beside times it doesn't match. | Missed trips | S (question) | No |
| 8 | **Show when the evidence read failed** instead of the silent "First underway evidence: Not observed" fallback. | Missed trips | S | No |
| 9 | **Block line names the neighbouring trips and bus** (C5). | Missed trips | M | No (TripStartLog has the block's trips) |
| 10 | **Detours aware of dates**: "Ended — close it" when finished or gone from the Avail feed; mute the Active pill on closed records; Central "today". | Detours | S–M | No |
| 11 | **Intake hand-off**: confirmation on submit, a link from Decided rows to the Detour, a mode chooser in the accept modal, and counts on the worklist tabs. | Detours | M | No |
| 12 | **Avail on the case**: an "Avail recorded / did not record a whole miss" line, and confirming probable Avail matches from the case. | Missed trips | M–L | No migration expected; may need an endpoint for confirming a probable link |
| 13 | **Dead-zone panel**: plain words, a date window, stops linking to their cases, the list visible to reviewers (not only admins). Separately, **apply migration 155 on dev**: it is unapplied, so the bar cannot be saved. | Missed trips | S (words) / M (window, links) | 155 already exists, still unapplied |
| 14 | **Re-review names the changed fields**; Clone carries the intake fields; "+ New Detour" asks the mode. | Detours | M | No |
| 15 | **Owner picker and default owner** for direct and Avail-synced detours. | Detours | M | No (normalising existing owner strings is a data fix) |
| 16 | **Notify OCC on intake submit, and the reporter on "returned for information".** | Detours | M | Probably no; Teams needs the Workflows webhook secrets |
| 17 | **Distinct history events** for assign, override and re-review. | Detours | M | Yes: the `event_type` CHECK (migration 046/049). Or derive from the detail text with none |
| 18 | **Separate reporting from deciding an intake.** | Detours | M | New access action (ADR-0032 app-owned roles), then a numbered step to grant it to the OCC reviewers |
| 19 | **A real "not yet carried out" state for manual detours** instead of starting at Fulfilled. | Detours | L | Yes: `lifecycle_state` CHECK (migration 122), plus an ADR-0030 amendment |

Items 1–6 together cover most of what a reviewer or dispatcher would misread
today, and none of them needs a schema change.
