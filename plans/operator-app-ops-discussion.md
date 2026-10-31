# Operator ridership app — three features for Operations to decide

**Status:** DRAFT for discussion with MVTA Operations, 2026-10-30. Nothing
here is decided. Recommendations are the project's starting position, not
Operations' answer.

**Background.** From 1 January 2027 ridership counts move from the paper Count
Sheet and the Access database into OnBoard (`plans/ridership-counting-spec.md`).
In the first version, contractor OCC staff key the paper sheets. A later
**operator app** lets operators enter their own counts: a web app on a garage
kiosk first, then on an MVTA-issued phone once OPR-038 is amended. In that
first operator version the operator signs in with their Avail logon ID and PIN,
picks their run from a list, and types each trip's total from their paper
tally after the trip.

**Try it:** a clickable prototype of all three features (one HTML file, open
it in a browser) is on branch `prototype/operator-app-ops-features` at
`plans/operator-app-ops-prototype.html`. Its guided scenarios cover a normal
stop, a short stop under a server-driven lock, creeping to the curb, end-of-line
boardings, a dismissed trip suggestion, GPS loss and a wrong block sign-in.

Three features were deliberately left out of that first version because each
needs a decision from Operations:

1. **Moving-bus lock** — the app refuses input while the bus is moving.
2. **Automatic trip selection** — the app knows which trip the operator is on.
3. **Phone mode** — the operator counts live on a phone, one tap per boarding.

---

## One-page summary

**The three are not independent. Phone mode is the decision; the other two
follow from it.**

- A garage kiosk never moves, so a **moving-bus lock** only matters if
  operators use a device on the bus. It is part of phone mode, not a feature
  on its own.
- **Automatic trip selection** is nearly free for after-the-fact entry (the app
  already knows the operator's block from their Avail logon) and only becomes
  important when the operator counts live and the app must know which trip each
  tap belongs to.

**What OnBoard can see today** (details in the Facts section):

- Where each bus is, and which block, run and trip Avail thinks it is on —
  about **30–45 seconds behind real time** on the server. Fine for "which trip
  is this", too slow and too coarse to tell whether a bus is moving *right now*.
- Which block each operator is logged into, and which bus pulled out on it.
- Every trip's scheduled start, and its actual start once it departs.

**Recommendations in one line each:**

| Feature | Recommendation |
|---|---|
| Phone mode | **Pilot it** on a small number of non-APC buses at one garage, on MVTA-issued mounted devices, after OPR-038 is amended and the labour side is cleared. Do not roll out fleet-wide until the pilot shows counts at least as good as paper. |
| Moving-bus lock | If phone mode goes ahead: **lock from the device's own GPS**, backed by a written rule in OPR-038. Not from OnBoard's server data (too slow), and not left to policy alone. |
| Automatic trip selection | **Suggest, never assume.** The app proposes the current trip from Avail's own trip assignment and the clock; the operator confirms with one tap. Use it in the first version too, to pre-mark trips that never started. |

**Cheaper alternative Operations should weigh against phone mode:** a
mechanical hand tally counter (a clicker) at the farebox plus the kiosk. It
gets most of the accuracy gain of a live tally with none of the device, SOP or
labour questions. What it can't give is tap times, and so no per-stop counts.

**The decisions needed from Operations** are numbered **O1–O14** below; the
first four decide the shape of everything else:

- **O1.** Does MVTA want operators to count on a device *during service* at all?
- **O2.** If yes, whose device: an MVTA-issued phone, a tablet, or the Avail MDT?
- **O3.** Which buses: only those without working APC, or all?
- **O4.** Who takes OPR-038's amendment and the labour question to the
  contractor and its operators, and by when?

---

## Facts — what OnBoard knows today

Established from the code and the dev database on 2026-10-30.

### Vehicle position and speed

| Source | How often OnBoard reads it | Has speed? | Has block/run/trip? | Where |
|---|---|---|---|---|
| Avail AVL Reports | Timer fires every 15 s; the effective interval is an admin setting clamped to 15–300 s, **30 s on dev** | **No** | **Yes** (block, run, trip as scheduled start HHMM) | `functions-restapi/src/functions/availAvlPoll.ts:148-151`, `:62`, `:167`; `src/lib/availAvl.ts:23-34`; `sql/migration-012-avail-avl-reports.sql:20-31` |
| GTFS-Realtime VehiclePosition | **Every 5 minutes** | Yes (`speed_mps`) and stop status | Trip ID, not block | `src/functions/gtfsVehiclePositionsPoll.ts:19-20`; `sql/migration-006-vehicle-positions.sql:18-25`; `src/lib/gtfsVehiclePositions.ts:78` |

Measured on dev, the evening of 2026-10-30:

- Avail AVL reports reach OnBoard **6–17 seconds** after the bus sent them
  (average 12 s), on top of the 30 s polling interval. Successive stored
  positions for a bus are most often 30–50 s apart.
- So a lock driven from OnBoard's server would learn that a bus has stopped
  **roughly 15–60 seconds late**, and could miss a short stop altogether. A
  typical stop where two or three people board is over in under 30 seconds.
- Avail's AVL report carries no speed. Speed would have to be worked out from
  two positions 30+ s apart, which can't tell "stopped at the stop" from
  "crawling in traffic".
- GTFS-RT carries speed and a "stopped at" status, but OnBoard reads it every
  five minutes. It could be read more often, but how often Avail refreshes the
  feed itself is unknown (question for Avail, A2).

### Who is on which block, and which trips the block runs

- **Operator → block → bus.** Avail's pull-out report gives, per service date,
  each block and run with the operator's Avail logon ID and the bus that pulled
  out (`FixedRouteDepartures`, `sql/migration-013-fixed-route-departures.sql:21-38`).
  About 135 buses, 205 operators and 135–160 blocks a weekday in October 2026.
- **Bus → current trip.** Each Avail AVL report names the block, run and trip
  the bus is on, with the trip as its scheduled start time in HHMM — the same
  number the Avail APC report and the Access TripID use (spec §12).
- **Block → its trips.** The Dispatch Log (`TripStartLog`,
  `sql/migration-094-trip-start-log.sql:29-47`) holds every trip with its
  block, route, direction, scheduled start and, once it departs, its actual
  start and where that came from.
- These join cleanly: the APC health work matched all 606 revenue trips of
  2026-10-28 from Avail's block + route + direction + HHMM to the Dispatch Log
  with no orphans.
- **Known gaps:** the bus on a block can change during the day (15 trips on
  2026-10-28 ran on a different bus from the one pull-out recorded), so the
  pull-out bus is not always the bus the operator is on; an operator logged
  into the wrong block in Avail would be offered the wrong trips; trippers and
  unscheduled trips aren't in the schedule.

### What the device and the MDT could offer

- **A phone's own GPS**, read by the web app, updates about once a second,
  reports speed directly on most phones, and keeps working in dead zones. It
  is the only source fast enough for a lock. Caveats: it needs a device with a
  GPS chip (Wi-Fi-only tablets don't have one), the operator or the device
  management profile must allow location, speed can be missing for the first
  few seconds after a cold start, and a phone kept in a pocket or under a
  metal roof reads poorly.
- **The Avail MDT** already knows when the bus is moving and, on most
  installations, when the doors are open — the best possible "at a stop"
  signal. OnBoard has no connection to it today, and nothing in Avail's
  reports exposes door or motion state. Whether Avail can show a counting
  screen on the MDT, or send door/motion state to another device, is a
  question for Avail (A1).
- **A garage kiosk** has none of this and needs none of it.

### What the paper process already says

- OPR-038, Operator Conduct: operators may not use a **personal** electronic
  device, including a mobile phone, on duty; every personal device is powered
  off and stowed out of sight. It doesn't address an **MVTA-issued** device.
- OPR-038, Ridership Counting: operators count every boarding and record it on
  the sheet; counts must be actual observations, never estimates.
- The draft Ridership SOP (branch `claude/ridership-sop-3b06a2`,
  `plans/sop-drafts/02-ridership-counting-and-reporting-sop.md`) already adds
  **"Do not write on the Count Sheet while the vehicle is moving"** as a
  REQUIREMENT. The same rule written for a device is the natural starting
  point for the lock.

---

## Feature 1 — Phone mode (live counting during service)

### What it would do

The operator has an MVTA-issued device at the farebox. As each passenger
boards, the operator taps **+1** (and −1 to correct). The app keeps a running
total per trip, moves to the next trip at the end of the line, and at pull-in
the operator reviews the block and taps Submit. Submitting replaces the paper
sheet for that block. Every tap is stored with its time, so OnBoard can place
each boarding at the stop the bus was at, giving **per-stop boardings** on
buses with no APC.

The prototype mocked this as the "Operator mobile" screen
(`OperatorMobile` in `RidershipEntryPrototype.tsx` on branch
`prototype/ridership-entry-variants`).

### What it gains over the first version

- **No transcription.** Today a count is written on paper and typed again by
  someone else; phone mode removes one copy and its errors.
- **Timeliness.** Counts arrive at pull-in, not after the sheet travels to OCC.
- **Tap times → per-stop counts.** Matching tap times to the bus's position
  gives boardings by stop. This is the only way to get stop-level ridership on
  buses without working APC, and a stop-level validation sample for APC
  buses (NTD requires APC to be validated against manual counts).
- **Evidence of counting.** Taps spread across a trip look different from a
  number typed at the end. This helps settle accuracy questions — and is also
  exactly why the labour side must be handled carefully (below).

### Safety and SOP implications

- **OPR-038 must change** before any device is used on the bus. Today's text
  bans personal devices; it says nothing about an issued one. The amendment
  should say which device is authorized, where it is mounted, and that it is
  used only while the bus is stopped with the doors open (or the brake set).
- **Distraction.** Tapping once per boarding while the bus is stopped is close
  to what operators already do with tally marks on paper. The risk is use
  while moving (reading the total, correcting a miscount) — which is what the
  lock addresses.
- **Law.** Minnesota's hands-free law (Minn. Stat. § 169.475) restricts using
  a wireless device while a vehicle is in motion or part of traffic. MVTA's
  counsel should confirm how it applies to a mounted, single-tap counting
  device used at a stop. Federal hand-held phone rules for commercial drivers
  may also be relevant to the contractor; counsel to confirm.
- **Liability.** If an operator is distracted by an MVTA-issued device, MVTA
  is closer to the incident than with a paper sheet. The lock, mounting and a
  clear written rule are what limit that exposure.

### Options

| | Option | For | Against |
|---|---|---|---|
| A | **No phone mode.** Paper tally, kiosk entry (first version as designed). | No device, SOP or labour change. Already planned. | Transcription stays. No tap times, no per-stop counts off APC buses. |
| B | **Hand tally counter + kiosk.** A mechanical clicker at the farebox; the total is read off at each terminal and typed at the kiosk. | A few dollars a bus. Counting is as easy as phone mode. No OPR-038 device issue. | Still transcribed (from clicker to paper/kiosk). No tap times. Operators must reset it per trip. |
| C | **MVTA-issued phone, mounted at the farebox.** | Full gains above. Cheap hardware. Offline-capable web app. GPS for the lock. | Devices to buy, mount, charge and manage. OPR-038 and labour changes. Phones get lost or broken. |
| D | **Counting on the Avail MDT.** | Already mounted, already on every bus, already knows motion and doors. No second device. | Depends entirely on Avail building or licensing it; cost and timeline unknown. The MDT screen is shared with dispatch messages operators must answer within 60 s. |
| E | **Use APC instead** on buses where it works, and phone mode only on the rest. | Counts with no operator effort where APC is good. | Needs the APC validation work (spec §12) first; APC coverage and health are not yet known. |

### Rough cost and effort

- **Option C hardware**, at typical market prices to be confirmed by MVTA IT:
  a rugged phone $300–600, a mount $50–150 plus installation, device
  management $3–6 per device per month, mobile data $20–40 per device per
  month if needed (counts are small; Wi-Fi sync at the garage may be enough).
  Devices stay with the bus, not the operator. A **pilot of 10 buses** is
  roughly $5–10k up front; **fleet-wide (about 135 buses)** roughly
  $60–100k up front and $40–70k a year.
- **Build:** the counting screen exists in the first version's design; the
  live tally, offline storage, tap times and per-stop placement are roughly
  **4–6 weeks** of work on top of it, plus the lock (Feature 2) and trip
  suggestion (Feature 3).
- **Option D:** unknown until Avail answers A1.
- **Option B:** clickers are a few dollars each; no build beyond the first
  version.

### Recommendation

**Pilot Option C on about 10 buses without working APC at one garage**, after
the kiosk pilot proves the after-the-fact entry. Ask Avail about Option D in
parallel; if Avail can do it at a reasonable price, it beats a second device.
Offer Option B to the contractor now as a no-regrets improvement to paper
counting. Don't roll out fleet-wide until the pilot's counts agree with APC
and paper at least as well as paper does.

### Decisions needed from Operations

**O1. Do we want operators counting on a device during service at all?**
*Recommendation:* yes, as a pilot only, subject to O4. The data gain (per-stop
counts without APC) is real but not needed for the January cutover.

**O2. Which device?** *Recommendation:* MVTA-issued phone, mounted, staying
with the bus. Ask Avail about the MDT first (A1); a Wi-Fi-only tablet is out
because it has no GPS for the lock.

**O3. Which buses?** *Recommendation:* buses without working APC first; on
APC buses, a small sample of counts both ways as the APC validation set.

**O4. Who clears OPR-038 and the labour question, and by when?**
*Recommendation:* MVTA Operations owns the OPR-038 amendment (drafts live with
the ridership SOP work); the contractor raises the device, new duty and
tap-time data with its operators' representatives before the pilot. Target:
cleared before the pilot starts, not before January.

**O5. Who may see tap-level data?** *Recommendation:* Planning sees per-stop
counts; nobody uses tap times to evaluate individual operators' productivity
or driving. State that in writing to the operators before the pilot.

**O6. Should the contractor adopt hand tally counters now?**
*Recommendation:* yes, as an optional aid, if the contractor agrees. Cheap, and
it improves the paper counts that January depends on.

---

## Feature 2 — Moving-bus lock

### What it would do

While the bus is moving, the counting screen is replaced with "Bus moving —
count at the stop". When the bus stops, it unlocks. Taps already made are
kept. The point is safety and showing compliance with OPR-038: the device
physically can't be used while driving.

Only relevant to phone mode (Feature 1). A garage kiosk doesn't move.

### Options

| | Lock driven by | For | Against |
|---|---|---|---|
| A | **The device's own GPS** | About 1-second response; works offline; no vendor dependency; small build. | Needs a GPS-capable device and location permission; slow first fix after start-up; can read "moving" in a garage or "stopped" under a bridge. |
| B | **OnBoard's server (Avail AVL)** | No device sensor needed. | 15–60 s late; no speed field; could miss short stops entirely and lock the operator out at the stop. Needs a live connection. Not recommended. |
| C | **The Avail MDT** (motion or door-open state) | Most accurate, especially door-open; the same signal Avail already trusts. | Requires Avail integration (A1); cost and timeline unknown. |
| D | **No lock; written rule only** | Nothing to build; no false lockouts. | Relies entirely on the operator; weak position if an incident happens. |

**Rules the lock needs whichever option is chosen:**

- **Unlock below about 3 mph, lock above about 5 mph**, with a few seconds'
  delay each way, so crawling to the curb or creeping in a queue doesn't flick
  the screen on and off. The thresholds are for Operations and Safety to set
  (O8).
- **When the device can't tell** (no GPS fix), what happens: lock (safest, but
  can block counting) or unlock with a warning. *Recommendation:* lock, with
  the end-of-trip review allowing the operator to add boardings they couldn't
  tap.
- **Corrections** (the −1 button, the review screen) are locked the same way.
- **Log lock events**, so OnBoard can show that the lock was working, without
  using them to assess individual operators (see O5).

### Rough cost and effort

- Option A: about **1 week** in the web app, plus testing on the chosen device.
- Option B: about 1 week, but not recommended.
- Option C: depends on Avail.
- Option D: SOP text only.

### Recommendation

**Option A plus Option D:** lock from the device's own GPS, and write the rule
into OPR-038 so the policy stands even if the lock fails. Move to Option C if
Avail can offer door-open state at a reasonable price.

### Decisions needed from Operations

**O7. Is a technical lock required, or is a written rule enough?**
*Recommendation:* both. The rule is the requirement; the lock enforces it.

**O8. What counts as "stopped"?** Speed thresholds and delays, and whether
"stopped in traffic" (not at a stop) should unlock. *Recommendation:* unlock
below about 3 mph after 2 seconds; Safety to set the final numbers. Counting
in stopped traffic is harmless because no one is boarding, so no need to
detect stops specifically.

**O9. With no GPS fix, lock or unlock?** *Recommendation:* lock, with
after-the-fact correction on the review screen.

---

## Feature 3 — Automatic trip selection

### What it would do

Instead of the operator picking their block and then each trip, the app works
it out:

1. **Block** from the operator's Avail logon (already in the first version,
   which lists the runs Avail shows them logged into first).
2. **Current trip** from Avail's own trip assignment for the bus (the AVL
   report's trip field), cross-checked against the clock and the Dispatch Log's
   scheduled and actual starts.
3. **Trip change** at the end of each trip: the app moves to the next trip
   when Avail does, or when the next trip's actual start appears.

### Where it helps

- **After-the-fact entry (first version):** the trip list is the whole block
  anyway, so the gain is small. But the Dispatch Log knows which trips actually
  started, so the app can **pre-mark trips that never started** as "Did not
  operate?" for the operator to confirm. That's a useful, cheap addition.
- **Phone mode:** essential. Every tap must land on the right trip, and the
  operator shouldn't have to think about it while serving passengers.

### What can go wrong

- **Terminal boardings.** Passengers board at the end of the line before the
  next trip departs. Do those count on the trip just finished or the next one?
  Operators' paper practice is the next trip. The app must switch trips at the
  terminal, not on departure.
- **Wrong Avail logon.** If the operator logs into the wrong block, the app
  offers the wrong trips. Today this shows up as a sheet for the wrong block;
  with automatic selection it would be silent.
- **Bus swaps, trippers, detours and short-turns** that aren't in the schedule.
- **No live connection** in a dead zone: the app must fall back to the clock
  and the schedule.

### Options

| | Option | For | Against |
|---|---|---|---|
| A | **Operator picks** (first version) | Simple; no wrong guesses. | Extra taps; operator can forget to move to the next trip in phone mode. |
| B | **App suggests, operator confirms** with one tap at each trip change | Gets it right almost every time; the operator stays in charge; errors are caught at the moment they happen. | One tap per trip. |
| C | **Fully automatic** | No operator effort. | Silent errors (wrong logon, terminal boardings, swaps) land in the data with nobody noticing. |

### Rough cost and effort

- Pre-marking trips that never started (first version): about **2–3 days**.
- Option B for phone mode: about **1–2 weeks**, needing a small live endpoint
  that returns the bus's current block and trip from the Avail AVL data
  OnBoard already stores, and a clock-and-schedule fallback on the device.

### Recommendation

**Option B.** Suggest the trip, confirm with one tap, switch at the terminal.
Add the "never started" pre-mark to the first version now.

### Decisions needed from Operations

**O10. Which trip do boardings at the terminal belong to?** *Recommendation:*
the next departing trip, matching paper practice; the SOP should say so.

**O11. Suggest-and-confirm, or fully automatic?** *Recommendation:*
suggest-and-confirm.

**O12. If the app's suggestion disagrees with the operator's Avail logon**
(e.g. the bus is on another block), who is right? *Recommendation:* the
operator chooses, and OnBoard flags the block for OCC to check, the same way
an unassigned sheet is flagged today.

**O13. Should the first version pre-mark trips that never started as "Did not
operate?"** *Recommendation:* yes, operator confirms.

**O14. Should the pre-mark and the trip suggestion also be shown to OCC staff
keying paper sheets?** *Recommendation:* yes; it's the same data, and it
catches sheets that disagree with what the bus actually did.

---

## Questions for Avail

- **A1.** Can the MDT show a simple counting screen, or send motion and
  door-open state to another device on the bus? At what cost?
- **A2.** How often is the GTFS-Realtime VehiclePosition feed refreshed, and
  how often does each bus report to the AVL Reports API?
- **A3.** When does the AVL report's trip field change from one trip to the
  next: at the terminal arrival, the layover, or the departure?
- **A4.** Which MVTA buses have working APC (also asked in spec §12)?

## What this brief does not change

The first version (kiosk entry from a paper tally) and the January cutover
(OCC staff keying paper sheets) go ahead whatever Operations decides here.
None of the three features is needed for either.
