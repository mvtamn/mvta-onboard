# Operator Kiosk — Evaluation

Date: 2026-10-31. **Not implemented. Nothing here is decided.** Each section
ends with a recommendation for the user, Operations or MVTA IT to accept or
change.

This is the "kiosk provisioning" scope that `plans/ridership-operator-app.md`
(PR #458) left open in its decision 2 and outside-the-code step 3. It does not
reopen that design's decisions:

- no hardware on buses and no MDT change;
- the kiosk comes first, and operators' own phones only after OPR-038 is
  amended;
- sign-in is the Avail logon ID plus a 6-digit OnBoard PIN;
- the operator picks the run, then keys one total per trip, with no automatic
  trip detection;
- a submission replaces the paper sheet, except during the pilot;
- there is one Count Sheet per block per service date.

Decision numbers (D7, D18 …) refer to that design. Plain section numbers
(§3.2, §8 …) are this document's own; "spec §5" means
`plans/ridership-counting-spec.md` (PR #455).

**Sources:**

- the operator app design (PR #458);
- the spec and gaps record (PR #455);
- the reconciliation review (PR #459);
- the Ops discussion brief (`plans/operator-app-ops-discussion.md`, branch
  `claude/operator-app-ops-features-aa1898`);
- ADR 0032;
- `functions-restapi/src/lib/auth.ts`;
- `migration-013` (`FixedRouteDepartures`) and `migration-094`
  (`TripStartLog`);
- the ridership schema in PR #457 (`migration-153`);
- read-only queries against the dev database on 2026-10-31.

## Summary

- **The kiosk is an operator platform, not a ridership device** (user,
  2026-10-31). Ridership is its first module. Vehicle condition reports,
  detour information for operators and other modules follow, in the same
  sign-in and the same device (§8). So the device role, the operator session
  and the API are named for the kiosk, not for ridership.
- **Android is the platform** (user, 2026-10-31).
- **One kiosk per garage covers the ridership peak. Buy two per garage
  anyway**, so that one failure does not send a garage back to paper, and
  because later modules add load.
- **Hardware:** a rugged 10–11" Android tablet with glove mode, NFC and a rear
  camera, in a locked wall enclosure with wired power. It is managed in Intune
  as an Android Enterprise dedicated device that runs the operator site in
  managed Chrome. **About $1,100–1,900 per kiosk, $2,200–3,800 per garage**,
  plus about $2–6 per device per month for management. Existing garage PCs
  are the fallback, not the kiosk.
- **Sign-in:** the first release uses the **Avail logon ID + PIN**. The
  sign-in is built to also accept a **badge, key fob or tag tapped on the
  tablet's NFC reader**, in place of typing the logon ID. Each badge is
  assigned to one operator in an OnBoard register, and the PIN is still
  required (§3.6).
- **Device trust:** each kiosk signs in to Entra as its own **kiosk account**
  (a non-person account). Conditional Access lets that account in only from
  an Intune-compliant kiosk. It holds one new app-owned role,
  **`operator-kiosk`**. The operator's credential then opens a short-lived
  operator session on top of that. The API requires both, and neither is
  enough alone.
- **Integration:** kiosk submissions write to the same `RidershipSheets` and
  `RidershipCounts` rows as OCC entry. PR #457's schema needs a
  **`count_source`** column (and some others, §4.2) before those rows go live
  on 2026-12-01, so kiosk data never has to be backfilled.
- **The garage count is not recorded** in the spec or the code
  (`RidershipBlockGarages.garage` is free text). It is open question Q1, and
  every per-garage figure below is per garage, to be multiplied by the answer.

## Facts from the dev database (2026-10-28, a weekday)

| Fact | Value | Why it matters |
|---|---|---|
| Blocks with revenue trips (`TripStartLog`) | 144 | One Count Sheet each, so 144 submissions a weekday, system-wide |
| Revenue trips | 606, so **4.2 per block** on average; minimum 1, maximum 12; 26 blocks have 8 or more | Sets the keying time per run |
| Most blocks whose last trip starts within any **15 minutes** | **8** | The peak pull-in arrival rate, system-wide, before the split by garage |
| … within any 30 minutes / 60 minutes | 14 / 24 | |
| Busiest hours for last-trip starts | 07:00 (21 blocks) and 16:00 (21 blocks) | Two pull-in waves, about 08:00–09:00 and 17:00–18:00 |
| Pull-out rows (`FixedRouteDepartures`) | 161, **one run per block**; run = block on 1,684 of 1,688 rows over 19–30 Oct | Avail's pull-out does not show relief as a second run (§4.4) |
| Pull-out rows with no logon ID | 11 of 161 | Those runs can never be "confirmed by Avail" (D11) |
| Distinct logon IDs in October | 204 | The number of PINs to issue |
| Logon ID length | **3–4 digits** | An ID is guessable, so the PIN and the device gate carry all of the security (§3.2) |

The last trip's start is a proxy for pull-in. The real pull-in is that time
plus the trip and the deadhead, so the waves are shifted later but keep their
shape. Block counts differ between pull-out (161) and the Dispatch Log (144),
because pull-out includes non-revenue and tripper blocks. The kiosk's run list
must come from the Dispatch Log, which is what needs a count, and use pull-out
only to order and confirm the runs.

## 1. Check-in flow and timing

### Flow at the kiosk

1. **Tap the screen and key the logon ID** (3–4 digits) on an on-screen
   number pad.
2. **Key the PIN** (6 digits). The kiosk shows the operator's name from
   Avail's pull-out ("Signed in as …, not you?") so a mistyped ID is caught at
   once.
3. **Choose the run.** The runs Avail shows this logon ID on for today come
   first, then today's other runs at this garage. Most operators tap the top
   row.
4. **Key a total per trip** from the paper tally, in trip order, with **DNO**
   per trip and an unscheduled-trip row. A trip with a confirmed missed-trip
   case shows as *Missed — no count needed*.
5. **Review and Submit.** The screen confirms "Submitted at 17:42, run 041"
   and signs the operator out.

### Time per run

These are estimates. The pilot measures the real figures (§6).

| Step | Typical (4 trips) | Long run (12 trips) |
|---|---|---|
| Sign-in (ID + PIN + name check) | 10–15 s | 10–15 s |
| Choose run | 3–5 s | 3–5 s |
| Totals, about 3 s per trip | 12 s | 36 s |
| Review + submit | 8–10 s | 15–20 s |
| **Total** | **about 35–45 s** | **about 65–75 s** |

The first sign-in adds about 30 s once, to change the one-time PIN.

### Queue at peak

There are about 8 pull-ins in the busiest 15 minutes, system-wide. At a
generous 60 s each, that is about 8 minutes of kiosk time in 15 minutes for
the whole system on one screen: about 55% busy. Split across two or more
garages, it is well under that. Arrivals bunch, because buses on the same
corridor pull in within a few minutes of each other. With 3–4 operators
arriving together at one garage, the last one waits 2–3 minutes on one
kiosk, or about 1 minute with two. The Ops brief puts paper hand-in at about
the same time, so the kiosk is not slower than today's check-in.

**Relief runs** may end at a relief point, not at the garage. Where those
operators check in decides whether they can reach a kiosk at all (Q2).

### When the kiosk is down

| Failure | What happens |
|---|---|
| One of two kiosks down | Operators use the other one. Garage staff report the fault to the owner (§3.5). |
| Network down at the garage, operator **already signed in** | Entries and Submit queue on the device and send later (D18). The screen shows *Saved on device*. |
| Network down, **not yet signed in** | The kiosk cannot check a PIN offline, and it should not cache PIN hashes, so it says "Kiosk offline — hand in your paper sheet". |
| Both kiosks down or OnBoard down | **Paper:** the operator hands the Count Sheet to the desk as today, and OCC keys it (source *OCC from paper*). The run stays on OCC's worklist because it has no submission. |

The paper fallback only works if the operator always tallies on the
**printed Count Sheet**, not on scrap paper. The sheet is already printed for
every block (spec §3), so the rule is: tally on the sheet; if the kiosk takes it,
the sheet is a tally card (D20); if not, hand it in.

A kiosk's **heartbeat** (last seen, from its periodic call to the API) should
show on Integrations & Data Health, so a kiosk that has been dead since the
morning is noticed before the evening wave, not at month end.

**Recommendation:** two kiosks per garage, at the check-in desk route. Tally
on the printed sheet always. Sign-in needs the network; Submit does not.
Kiosk heartbeat on the health page. Paper keyed by OCC is the only fallback.

## 2. Hardware

### Options

| | Rugged tablet in a wall enclosure | All-in-one touchscreen PC | Reuse garage PCs |
|---|---|---|---|
| Example class | 10–11" rugged Android tablet with glove mode and a user-replaceable battery, or an iPad in a commercial enclosure | 15–22" commercial Windows all-in-one with a projected-capacitive touchscreen | The check-in desk or dispatch PC, perhaps with an added touch monitor |
| Durability | Rated for drops, dust and water (IP65/68, MIL-STD-810 on the rugged models); the enclosure takes knocks | Built for retail and hospitality kiosks; a larger glass face to protect | Office-grade, keyboard and mouse; not built for walk-up use |
| Gloves | Glove mode on rugged models; consumer iPads need touch gloves | Most projected-capacitive screens have a glove setting | Mouse and keyboard work with gloves; touch only with an added monitor |
| Mounting | Wall or pedestal enclosure, locked, with cable routing | VESA wall arm or floor stand | Already on a desk |
| Power | Wired USB-C through the enclosure; the battery covers short power cuts | Mains; a small UPS is advisable | Existing |
| Network | Garage Wi-Fi; no cellular needed | Wired Ethernet (preferred) or Wi-Fi | Existing, but probably the contractor's network |
| Kiosk lock-down | Intune Android Enterprise **dedicated device**: Managed Home Screen pinned to one managed browser, allow-listed to the operator site | Intune **Assigned Access**: Edge kiosk mode, one site | Not lockable without taking the PC away from its current job |
| Cost per kiosk (market estimate, to confirm with IT) | Tablet $600–1,000, enclosure $300–600, install and cabling $200–300: **$1,100–1,900** | Unit $1,500–2,800, mount $150–400, install $200–300, UPS $100: **$1,950–3,600** | $0–500 for a touch monitor |
| Ongoing | Device management $2–6 a month; battery swap in 3–4 years | Same management; longer life | None new |

### How many

At least **two kiosks per garage**, for the reason in §1. A third is worth it
only where one garage takes most of the evening wave. That can be read off the
block-to-garage list once Planning has entered it (spec §5). With G garages:

- **Rugged tablets:** about $2,200–3,800 × G up front, and $50–150 × G a year.
- **All-in-one PCs:** about $3,900–7,200 × G up front.

If MVTA has two garages, a tablet fleet is **about $4,400–7,600** up front,
plus a spare unit (about $1,000).

### Why not reuse garage PCs

They are the right **fallback** for desk staff, who key PINs and can open
drafts in the console (§4.4). They are wrong as the kiosk:

- Operators would queue at the desk PC that the desk itself needs at the same
  moment.
- A PC that also does dispatch work cannot be locked to one site.
- The desk PC may belong to the contractor and sit on their network, and
  that network changes on 2027-01-01.

**Decided: Android** (user, 2026-10-31). That rules out the all-in-one
Windows column above. It stays in the table only to record the comparison.

**Recommendation:** rugged Android tablets in locked wall enclosures, two per
garage plus one spare, on wired power and garage Wi-Fi.

What to require of the model, because later modules (§8) depend on it:

- **NFC (13.56 MHz)**, for badge sign-in (§3.6);
- **a rear camera with an enclosure cut-out**, for photos on vehicle
  condition reports;
- **11" rather than 10"** if the price gap is small, because detour maps read
  better larger;
- **Android Enterprise Recommended** status and at least **4 years of
  security updates** from the maker, because the device outlives one
  contractor.

## 3. Device management and security

### 3.1 Kiosk-mode browser, not a packaged app

The operator app is a website by design (D4: a Vite package like `rider-app`,
installable as a PWA). A managed kiosk browser pinned to its address:

- updates when the site deploys, with no app-store release, no MDM app push
  and no version skew between kiosks;
- uses the same build as phone mode later;
- is a supported, configured feature in Intune on Android: a dedicated device
  with Managed Home Screen and one pinned browser.

**Use Chrome, not Edge, as the kiosk browser.** Chrome on Android is the only
browser with **Web NFC**, which lets the page read a badge's serial number
(§3.6). A USB reader that types like a keyboard works in any browser, but
needs a cable through the enclosure.

A packaged app (a wrapper around the same site) would add only access to
device features the kiosk does not need, at the cost of a release pipeline.

**Recommendation:** managed browser in single-app kiosk mode. Allow-list the
operator site's host and the Entra sign-in host only. Turn off the address
bar, downloads, other tabs and the browser's own sign-in, and clear browsing
data on each session end.

### 3.2 How the device proves it is a kiosk

The REST API today trusts Entra tokens validated by Easy Auth (`auth.ts`).
Human authority comes from app-owned Role Grants keyed by Entra object id
(ADR 0032), and workloads carry Entra app roles (`System.Ingestion`).
Operators are not Entra users (D7).

**Why the PIN alone is not enough.** Logon IDs are 3–4 digits, so any ID can
be guessed. If the operator endpoints were anonymous, like the rider
subscription endpoints, anyone on the internet could try one PIN against
every one of the 204 IDs. That spray stays under each ID's 5-try lockout and
locks real operators out on purpose. A device gate takes both risks off the
public internet.

| Option | How | For | Against |
|---|---|---|---|
| A. Anonymous + PIN only | Operator endpoints open; PIN, lockout and rate limits only | Nothing to provision | The spray and lockout attack above; no way to tell a kiosk from a laptop |
| B. **Kiosk account per device** | Each kiosk has a non-person Entra **user** account (no mailbox, no licence beyond what CA needs). The kiosk browser signs in once at enrolment and keeps the session. Conditional Access lets the account in **only from an Intune-compliant device**, optionally only from a garage network location. OnBoard grants the account the app-owned role `operator-kiosk` | Uses the Entra + Easy Auth path that exists today; revocable in seconds in Access & Identity (ADR 0032) and in Entra; the grant names the kiosk, so every submission records which device; no secret on the device beyond Entra's own session | One Entra account per kiosk to create and CA-scope; the session must be refreshed if it lapses (IT re-signs in) |
| C. Kiosk service principal + certificate | One app registration per garage with an Entra app role `Ridership.Kiosk`; an Intune-deployed certificate on the device | Workload-shaped, like `System.Ingestion` | A browser page cannot run the client-credentials flow, so this needs a packaged app or mutual TLS at the Function App; a heavier build for the same result |
| D. Mutual TLS with a device certificate | Intune deploys a client certificate; the API checks it | Strong, invisible to the operator | Front Door / SWA / Functions client-certificate setup is fiddly, and OnBoard has none today |

**Recommendation: B.** Each kiosk is a named, revocable identity on the path
that exists today. The new role `operator-kiosk` carries one action,
`operator-kiosk.use` ("act as a garage kiosk"). That action lets the device call
the operator sign-in, module list and heartbeat endpoints, and nothing else in
OnBoard: no console, and no module's data without an operator session. The
action is not ridership's, so adding a module later (§8) needs no new device
role or Entra step. Each
kiosk's grant records its **garage**, which sets the default run list and is
stamped on every submission. This uses ADR 0032's nullable grant scope, or a
small kiosk register if the scope stays agreement-only. This is an app-owned
role on a user object, not a workload app role, which fits ADR 0032: the kiosk
account signs in like a user, and its access must be revocable from Access &
Identity.

**The operator session** sits on top of the device. `POST
/api/operator/session` checks the logon ID and PIN and returns a short-lived
token. That token is signed by OnBoard, lives 5 minutes, and is bound to the
kiosk account that asked for it. Every operator call needs both tokens.

The operator credential (logon ID → PIN hash, lockout, reset) is new
authentication, not an ADR 0032 role. As step 4 of the operator app design
already says, it needs **its own ADR before code**. This evaluation's
recommendation is an input to that ADR.

### 3.3 PINs: issue, reset and storage

D8 already sets the rules: the desk issues a one-time PIN, the operator
changes it at first sign-in, 5 wrong tries lock it, and the desk resets it.
This evaluation adds the following.

**Storage:**

- Keep a salted, slow hash (scrypt or argon2id; Node has `crypto.scrypt`),
  keyed by logon ID. Never store or log the PIN.
- Write every issue, reset, lock and unlock to the audit log, with the desk
  user and the time.

**Which logon IDs can hold a PIN.** D8 says "logon IDs in Avail's operator
data". OnBoard reads no operator roster from Avail. `lib/availClient.ts` calls
AVL, pull-out, OTP, missed trips and detours only. The only list is the logon
IDs seen in `FixedRouteDepartures`: 204 in October. Until Avail can supply a
roster (Q4), use that list:

- an ID seen in pull-out in the last 60 days can be issued a PIN;
- a new hire can be issued one after their first pull-out;
- the desk can enter the name to confirm.

**One-time PINs:**

- random, never sequential or a birth date;
- valid for 72 hours;
- shown once on the desk's screen, never emailed or texted.

**Rules the kiosk enforces on a chosen PIN:**

- not all one digit;
- not a run of digits (123456);
- not the logon ID padded out.

**Leavers:**

- A PIN whose logon ID has not appeared in pull-out for 90 days is disabled
  and must be reissued.
- The contractor tells the desk when an operator leaves, and the desk disables
  the PIN at once. Write this into the procedure.

**Recommendation:** as above, under the role in the operator app design's
step 5. That design names it `ridership-operator-admin`. Because the PIN now
signs operators in to every kiosk module, not only ridership, this evaluation
proposes renaming it **`operator-credential-admin`**, holding PINs and badges
(§3.6). If the user agrees, #458 changes its step 5 to match. Ask Avail for an
operator roster endpoint (Q4).

### 3.4 Auto sign-out and lockout

**Sign-out** (D9):

- The kiosk signs out after **Submit**.
- It also signs out after **2 minutes** of no touch. A 20-second "Still
  there?" warning comes at 1:40.
- The draft is saved on the server as the operator works (D17), so signing
  out loses nothing.
- At sign-out the screen goes back to the logon pad and the browser's session
  storage is cleared.

**Lockout:**

- Per logon ID: 5 wrong PINs locks it until the desk resets it (D8).
- Per kiosk: **10 failed sign-ins in 10 minutes**, across any IDs, pauses
  that kiosk for 5 minutes and alerts the health page. This catches someone
  working through IDs at the screen.
- The operator is shown "PIN locked — see the desk", never which part was
  wrong.

### 3.5 Device management and who owns it

**Enrolment and management:**

- Intune in MVTA's tenant: Android Enterprise dedicated devices.
- A compliance policy: OS patch level, encryption, no developer mode.
- Conditional Access on the kiosk accounts (§3.2).
- Remote wipe or retire.
- OS and browser updates are installed automatically outside the pull-in
  waves, for example at 02:00. Overnight is outside fixed-route service
  hours, so it never collides with use.

**Ownership:**

| | MVTA IT owns the devices | The contractor owns them |
|---|---|---|
| Trust | MVTA's tenant, MVTA's CA policies; the kiosk accounts are MVTA's | The contractor's tenant would have to be trusted, or its devices enrolled in MVTA's |
| Continuity | Survives a contractor change; the next one is 2027-01-01 | Devices leave with the contractor |
| Effort | IT patches and replaces devices | Contractor IT does |

**Recommendation:**

- **MVTA owns, enrols and patches the kiosks.** The submission is MVTA's
  record and feeds a contract penalty (spec §8), so the device that creates it
  should be MVTA's.
- **The contractor has physical custody.** It keeps the kiosks clean and
  charged, reports faults the same day, and has no admin rights.
- Both go into the procedure and, if Operations agrees, the contract's
  equipment schedule.

### 3.6 Sign-in with a badge, key fob or tag

Added at the user's request, 2026-10-31. The user asked whether operators
could tap an RFID card, key fob or tag instead of, or as well as, keying the
Avail logon ID and PIN.

**What a tap can do.** A badge carries a number (its serial number, or a
value written to it). OnBoard looks that number up in a **badge register**
(badge → logon ID), so the tap does what keying the logon ID does today. It
proves the operator **holds** the badge, not that they **are** the operator.
A lost or lent badge works for whoever has it, and the cheap tag types can be
copied. So the choice is what the tap replaces:

| | Option | Sign-in | For | Against |
|---|---|---|---|---|
| 1 | **Logon ID + PIN** (first release) | Key 3–4 digits, then 6 | Nothing to issue or buy; ships with D7 as designed | About 10–15 s of keying; a mistyped ID |
| 2 | **Badge tap + PIN** | Tap, then key 6 digits | Faster (about 5 s saved) and no mistyped ID; still two factors (badge held + PIN known) | A badge per operator to issue, register and replace |
| 3 | Badge tap alone | Tap | Fastest | One factor: a lost, lent or copied badge signs in as its operator. Weak for anything the operator attests (vehicle condition reports, §8) |
| 4 | **Unassigned tags** (a pool at the desk) | A tag lent for the shift, then the logon ID + PIN | Lets the desk hand out a spare when a badge is forgotten | The tag identifies nobody until the desk assigns it for that day. It only adds a step to option 1 unless it is assigned in the register for the shift |

**Which badges.** This decides the hardware.

- **The contractor's or MVTA's existing building access badges.** No new card
  for the operator. Most are 125 kHz proximity cards (an Android tablet
  cannot read them at all) or secure 13.56 MHz cards (HID iCLASS, Seos,
  MIFARE DESFire). On the secure cards a tablet usually reads only a serial
  number, which may be random per tap. Both need a **USB multi-technology
  reader** that types the card number like a keyboard: about $100–200 per
  kiosk, with a cable through the enclosure. Using the contractor's badges
  also means their numbers change when the contractor changes.
- **New OnBoard fobs or tags.** Low-cost 13.56 MHz NFC fobs (NTAG class, about
  $1–3 each) are read by the **tablet's own NFC** through Web NFC in Chrome,
  with no extra reader. They are encoded at issue with a random value that the
  register maps to the logon ID. They are easy to copy, which is acceptable
  only because the PIN is still required.

**Register and lifecycle**, in OnBoard, under `operator-credential-admin`
(§3.3):

- The desk taps a new badge at the desk kiosk to assign it to a logon ID.
- A badge reported lost is disabled at once, and the operator falls back to
  logon ID + PIN until a new one is issued.
- A badge is disabled with its PIN when the operator leaves (§3.3).
- Every assign, disable and replace is in the audit log.
- A desk can assign a pool tag to an operator **for one service date only**
  (option 4). It expires at the end of that date.

**Recommendation:**

- Ship **option 1** for the pilot.
- Build the session endpoint to take **either a logon ID or a badge number,
  plus the PIN**, so option 2 is a configuration and register change, not a
  rebuild.
- Choose option 2 with **new NFC fobs** if Operations wants faster sign-in
  after the pilot. Check the contractor's badges only if the contractor wants
  one card for everything (Q9).
- Do not use option 3 (tap alone) for any module where the operator submits
  or attests something. A tap with no PIN is acceptable only for read-only
  information (§8), and that needs no sign-in at all.

## 4. OnBoard integration

### 4.1 API surface

All operator endpoints need the kiosk account's `operator-kiosk.use` action. All
except the session call also need an operator session. Service date is
Central and agency-local, CHAR(8), as everywhere in the Dispatch Log.

| Endpoint | Does | Validation |
|---|---|---|
| `POST /api/operator/session` | Logon ID **or badge number** + PIN → a generic operator session for every module (§8); first sign-in forces a PIN change | Lockout rules (§3.4); returns the operator's name from pull-out for the "not you?" check |
| `POST /api/operator/pin` | Change own PIN | PIN rules (§3.3) |
| `GET /api/operator/ridership/runs?serviceDate=` | Runs for the kiosk's garage and date: the operator's Avail runs first, then the garage's other blocks, each with its state (*not started*, *draft*, *submitted*, *submitted by OCC*) | Date is today or yesterday (Central) only; blocks from `TripStartLog` via `RidershipBlockGarages`; Unassigned blocks listed last so they are not lost |
| `GET /api/operator/ridership/runs/{date}/{block}` | The run's trips in order (route, direction, scheduled start and end, trip ID) with Dispatch Log status, any confirmed missed-trip case, and the saved draft | Block exists on the date |
| `PUT /api/operator/ridership/runs/{date}/{block}/draft` | Save a draft | The same per-trip checks as Submit, as warnings |
| `POST /api/operator/ridership/runs/{date}/{block}/submit` | Submit, with an idempotency key (D18) | See below |
| `POST /api/operator/ridership/runs/{date}/{block}/reopen` | Reopen own submission until the end of the service date (D19) | Only the submitting operator, only that day |
| `POST /api/operator/heartbeat` | Kiosk last-seen and app version | Kiosk account only |
| `POST /api/admin/operator-pins/{logonId}/issue`, `…/reset`, `…/disable` | Desk actions | `operator-credential-admin`; ID in the eligible list (§3.3) |

**Submit validation against the Dispatch Log.** Errors refuse the submission;
warnings are shown to the operator and then go to OCC.

| Check | Kind |
|---|---|
| Every trip ID belongs to this block on this date in `TripStartLog` | Error |
| Every required trip (spec §5) has a number, **DNO**, or **Not counted** | Error. Not counted is allowed but visible, never a 0 |
| Boardings are whole numbers from 0 up to a hard cap (a setting, e.g. 200) | Error |
| Boardings above a soft cap (a setting, e.g. 90) ask "Are you sure?" | Warning |
| DNO on a trip whose `start_status` shows it started | Warning, shown to OCC (D13) |
| A count on a trip with a confirmed missed-trip case | Not offered (D13) |
| An unscheduled trip has route, direction, start time and a reason | Error (D14) |
| The operator's logon ID is not on this block in `FixedRouteDepartures`, or pull-out has no logon ID | Accepted, marked **block not confirmed by Avail** (D11) |
| The block already has an OCC entry | Refused: "OCC has already entered this run". The operator tells the desk |

`FixedRouteDepartures.block` is an integer and `TripStartLog.block_id` is
the GTFS form (`10-v64`). Join them through the existing `workbookBlock()`
conversion that PR #457 uses, never by string.

### 4.2 Same records as OCC entry

A kiosk submission writes the **same rows** as OCC entry:

- `RidershipSheets`, one per block and service date;
- `RidershipCounts`, one per trip;
- `RidershipAddedTrips` for unscheduled trips;
- `RidershipCountHistory` for every change.

The completeness view, flags (spec §6), month close (spec §7) and candidate occurrences
(spec §8) need no separate kiosk path.

PR #457's `migration-153` is not yet merged. `RidershipSheets` there has no
source, and `entered_by` is a free-text staff name. Add these columns to it
now, so the 2026-12-01 rows carry them and kiosk rows need no backfill:

| Column | Values | Why |
|---|---|---|
| `count_source` | `occ_paper`, `occ_draft`, `kiosk`, `phone` | D22; the Source column in completeness; required, with a default of `occ_paper` |
| `submitted_at` | When the operator pressed Submit | D18: the device's press time, which can be earlier than the server's receipt when queued offline. Lateness (spec §5) is judged on it |
| `submitted_device` | The kiosk account's object id | Which kiosk; ties the record to the device grant |
| `submitted_logon_id` | The operator's Avail logon ID | Who submitted, as opposed to who Avail shows on the block |
| `avail_confirmed` | BIT | D11's *block not confirmed by Avail* |
| `garage_at_submit` | The kiosk's garage | Which garage's kiosk took the submission, whatever the block-to-garage list says |

`entered_at` / `entered_by` keep their meaning: the first time the sheet was
complete, and by whom. For a kiosk row, `entered_by` is
`operator:<logon ID>`. The history table's `changed_by` uses the same form,
so who changed what reads the same for staff and operators. Whether these
columns ship in #457 or in the operator app's first migration is for that
PR's owner. Shipping them in #457 is cheaper, because nothing has been
written yet.

### 4.3 Audit trail

Every row in the history keeps who and when, as P6 requires. The kiosk adds
three kinds of event, all recorded with device, logon ID and time:

- **sign-ins:** success, failure and lockout, kept for 13 months. These
  events identify operators, and the repo's rule is no operator data in
  examples or logs beyond what is needed;
- **PIN events:** issue, reset, disable and change, with the desk user;
- **submit and reopen:** written to `RidershipCountHistory` like any edit.

App Insights logs carry the device and the logon ID, never the PIN.

### 4.4 Completeness view

- A kiosk submission marks the sheet **entered** at `submitted_at`. It drops
  off OCC's worklist (D21), with a filter to show it.
- The **Source** column (D22) shows kiosk, phone, OCC from paper or OCC from
  draft. A per-garage roll-up gives the share of runs submitted at the kiosk,
  which is the main pilot measure (§6).
- *Block not confirmed by Avail* and the DNO-but-started warning show as
  badges on the row for OCC to confirm. They do not make the sheet
  incomplete.
- A **draft that was never submitted** shows as *not yet submitted (draft)*
  for the desk. It stays required, and late at the deadline, until OCC submits
  it (*OCC from draft*).

**Relief.** Pull-out has one run per block (run = block on 1,684 of 1,688
rows), so it cannot show a relief operator. Under D15, "any operator Avail
shows on that run" may open it. In practice that means only the first
operator, and a relief operator lands in *block not confirmed by Avail*.
That is acceptable, because the submission is still accepted, but OCC will
see it on every relief run. Ask Avail whether pull-out can carry relief runs
(Q5).

**Recommendation:** add the six columns to #457's schema before it merges.
Build the endpoints above in the operator app's increment. Show the Source
column and the per-garage kiosk share in completeness.

## 5. Accessibility and usability

| Concern | Recommendation |
|---|---|
| **Gloves** (winter) | Glove-mode touchscreen. Touch targets at least **15 mm** (about 60 CSS px on a 10" tablet), well above WCAG 2.2's 24 px minimum, with 8 mm between them. An on-screen number pad, never the system keyboard |
| **Glare** | Mount away from doors and windows, below eye level, tilted back about 15°. Matte anti-glare film. A screen of 500 nits or more. High-contrast theme by default (WCAG AA 4.5:1 at least; aim for 7:1) |
| **Reading** | Short words and numbers first: "Run 041", "Trip 3 of 6 · 16:42 Rt 420 N". No paragraphs. Icons only beside words |
| **Languages** | Which languages operators read is not recorded (Q6). Ship English first, with all text in one strings file, so a second language is a translation, not a rebuild. Ask the contractor at hiring which languages its operators read |
| **Single screen** | One task per screen: sign-in → run → trips → review. The trips screen is a scrolling list of large rows with a sticky Submit bar at the bottom, never a grid. A 12-trip run fits in two screens of scrolling on 10" portrait |
| **Low vision and height** | Text at least 20 px on the trips screen; the logon pad no higher than 1.2 m to its centre, which also suits wheelchair users (ADA reach range) |
| **Mistakes** | Each trip shows the number large after it is keyed; Review lists every trip with its total before Submit; Reopen until the end of the day (D19) |
| **Privacy** | The PIN pad shuffles nothing (operators learn it by position), but the enclosure has side hoods so the PIN is not readable from beside the kiosk |

## 6. Pilot plan and success measures

The pilot timing is already decided (D24): one garage, starting no earlier
than after the March 2027 month close, with 4 weeks of parallel OCC keying of
the same paper.

**Before the pilot:**

- the devices are enrolled;
- PINs are issued to every operator at the garage;
- training is done (§7);
- the kiosk has run for a week at the desk with staff test accounts.

**Week 0:** the desk issues one-time PINs at sign-in for the pilot week.

**Weeks 1–4 (parallel):**

- Operators submit at the kiosk and still hand in the sheet.
- OCC keys the sheet too, into a **comparison** record, not the live sheet.
- Each day, OnBoard compares the two trip by trip, as December compares
  Access with OnBoard.

**Measures** (from `count_source`, `submitted_at`, history and the
comparison):

| Measure | Target to end paper at the garage |
|---|---|
| Share of the garage's runs submitted at the kiosk | ≥ 90% in weeks 3–4 |
| Median time from sign-in to Submit | ≤ 60 s, and 90th percentile ≤ 2 min |
| Longest queue seen at the evening wave | ≤ 3 minutes (desk observation, two evenings a week) |
| Trips where kiosk and paper disagree | ≤ 2% of trips, each explained (usually a keying slip on one side) |
| **Correction rate:** sheets changed after entry, kiosk vs OCC keying of the same garage the month before | Kiosk no worse than OCC |
| Flag rate (spec §6 outliers) per 1,000 trips | Kiosk no worse than OCC |
| PIN lockouts per week | Falling by week 4; fewer than 5 a week |
| Kiosk downtime during pull-in waves | Under 1% of wave minutes |

If the targets are met, the garage stops OCC keying for kiosk-submitted runs.
The other garages follow one at a time, with a 2-week check each, not
another 4-week parallel run. If they are missed, the pilot extends 4 weeks
with the fixes.

## 7. Steps outside the code (numbered, owner in brackets)

1. **Confirm the number of garages** and which one pilots. [Operations]
2. **Agree device ownership:** MVTA owns, enrols and patches; the contractor
   has custody and reports faults. Write it into the procedure and, if
   needed, the contract's equipment schedule. [Operations + MVTA IT, with
   Keolis]
3. **Choose and procure the hardware:** two kiosks per garage plus one spare,
   with enclosures, after IT confirms its Intune platform (Android Enterprise
   enrolment works on the chosen model). [MVTA IT + Procurement]
4. **Network at each garage:** confirm Wi-Fi coverage at the kiosk spot, or
   pull a cable. Put the kiosks on an MVTA-managed network or SSID, and allow
   the operator site and Entra hosts. [MVTA IT, with garage facilities]
5. **Mounting and power:** site survey at each garage at the check-in route
   (reach height, glare, a power outlet), then install. [Operations + garage
   facilities]
6. **Create one Entra kiosk account per device:** a non-person account with
   no mailbox, named for the garage and number (for example
   `kiosk-garageA-01`). Add it to the OnBoard Users group so sign-in is
   allowed. [MVTA IT]
7. **Conditional Access policy:** the kiosk accounts may sign in only from an
   Intune-compliant device, and optionally only from garage networks. No MFA
   prompt, because the device is the second factor. Session lifetime long
   enough not to lapse between visits. [MVTA IT]
8. **Seed the app-owned role `operator-kiosk`** with the single action
   `operator-kiosk.use` in the app-owned roles table, by migration. [Engineering]
9. **Grant `operator-kiosk` to each kiosk account** in Access & Identity,
   with its garage. Revoke it when a device is retired or lost. [An access
   administrator]
10. **Enrol each device in Intune** as an Android Enterprise dedicated device,
    with the kiosk browser allow-listed to the operator site, the compliance
    policy, and an overnight update window. Sign the kiosk account in once.
    [MVTA IT]
11. **Seed `operator-credential-admin`** (operator app design step 5).
    [Engineering]
12. **Assign `operator-credential-admin`** to named check-in desk staff at the
    pilot garage, as Entra B2B guests (operator app design step 6). [MVTA IT
    + an access administrator]
13. **Issue PINs:** the desk issues a one-time PIN to every operator at the
    pilot garage in the week before the pilot, at sign-in, in person. [Keolis
    garage management, with the desk]
14. **Write the ADR for the operator credential** (logon ID + PIN, operator
    session bound to the kiosk account), before code. [Engineering]
15. **Ask Avail** questions Q4 and Q5 (an operator roster; relief runs in
    pull-out). [User]
16. **Contractor training:** a 10-minute briefing per operator at the pilot
    garage, a one-page card at each kiosk, and desk training on PIN issue,
    reset and *not yet submitted* drafts. [Keolis training, with Planning]
17. **Procedure change:**
    - tally on the printed sheet always;
    - submit at the kiosk at pull-in;
    - hand in the sheet only if the kiosk does not take it;
    - leavers' PINs are disabled the same day;
    - kiosk faults are reported to MVTA IT.

    This goes into `plans/ridership-counting-procedure-draft.md` and the
    OPR-038 amendment already planned (spec §11 step 5). The kiosk needs no
    OPR-038 device change: it is not on the bus and not a personal device.
    [Planning + Operations]
18. **Labour:** kiosk time at pull-in is paid time (operator app design
    step 2). [Operations, with Keolis]
19. **Only if badge sign-in (§3.6, option 2) is chosen after the pilot:**
    decide new NFC fobs or the contractor's badges (Q9), buy fobs (and a USB
    reader per kiosk if the contractor's badges are used), and register each
    badge to its operator at the desk. [Operations + MVTA IT; the desk
    registers]
20. **Name an owner for each later module** before it is designed: Fleet for
    vehicle condition reports (Q10), OCC or Planning for operator-facing
    detour information. [Operations]

## 8. The kiosk as an operator platform

Added at the user's request, 2026-10-31. The kiosk should report ridership
first, and be flexible enough for other operator functions later:

- vehicle condition reports;
- detour information;
- others.

None of those modules is designed here. This section says what the first
release must do **now** so that adding them later is a module, not a second
kiosk.

### Candidate modules

| Module | What the operator does | Sign-in | Notes |
|---|---|---|---|
| **Ridership** (first) | Enter the run's counts (§1, §4) | Logon ID or badge + PIN | This evaluation |
| **Vehicle condition report** | Report a defect on the bus they drove: bus number, category, a note, optional photo, "safe to operate?" | Badge or ID + PIN (an attestation) | Who receives it and what system holds fleet defects today is unknown (Q10). OnBoard has no work-order system (spec §14), so this may be a report that is forwarded, not a work order. The APC health worklist (spec §14) is Fleet's other OnBoard view, and a per-bus defect list fits beside it |
| **Detour information** | Read the active detours and stop closures on the garage's routes before pulling out | **None**: shown on the kiosk's idle screen | OnBoard's Detour module already holds them (Detour Register, Detours & Closures). Operators need only the active ones with directions and a map. Rider-facing detour text is already public, so the idle screen needs no sign-in |
| Others later | Read garage notices; acknowledge a bulletin or SOP change; see one's own runs for the day | Read: none. Acknowledge: ID + PIN | Acknowledgement is a record against an operator, so it needs the PIN |

### What the first release must get right

- **A shell with modules.** The operator site (D4,
  `frontend/packages/operator-app`) opens on a home screen of module tiles
  after sign-in, even while Ridership is the only tile. Each module is its own
  route and its own API area (`/api/operator/ridership/…`,
  `/api/operator/vehicle-reports/…`). The sign-in, auto sign-out, offline
  queue and on-screen number pad are shared parts of the shell, not of
  ridership.
- **A generic operator session.** `POST /api/operator/session` returns an
  operator session, not a ridership session. Each module checks the
  operator's access for itself. Operators are not Entra users, so ADR 0032's
  grants do not apply to them. Start with **every signed-in operator may use
  every enabled module**, and add per-module operator access only when a
  module needs it.
- **Modules switched on per garage.** Each kiosk grant's garage (§3.2) has a
  list of enabled modules, a setting edited by an access administrator, so a
  module can pilot at one garage the way ridership does.
- **The idle screen is a module surface.** It shows the active detours for the
  garage's routes and a "Tap to sign in" bar. It is read-only, needs no
  operator session, and is served under the kiosk account alone
  (`operator-kiosk.use`).
- **Hardware already chosen for it** (§2): a rear camera for defect photos,
  an 11" screen for detour maps, and NFC for badges.
- **The device identity is not ridership's.** It is the `operator-kiosk` role
  and the `operator-kiosk.use` action, and the PIN admin role is
  `operator-credential-admin` (§3.3). A new module needs no new device or
  Entra step.

### Load

Ridership alone uses each kiosk about half of the peak 15 minutes (§1).
Vehicle reports would be filed at the same moment, at pull-in, but only by
operators with a defect. Detour reading happens at pull-out, the other end of
the shift, and mostly on the idle screen without a sign-in. Two kiosks per
garage still cover it. Re-measure in the pilot before a second module goes
live.

**Recommendation:** build the operator site as a module shell from the first
release, with the generic session, the per-garage module switch and the
detour idle screen. The idle screen is cheap, uses data OnBoard already has,
and gives operators a reason to look at the kiosk before they need it. Design
vehicle condition reports separately, once Fleet says where defects go today
(Q10).

## Open questions

| # | Question | For |
|---|---|---|
| Q1 | How many garages does MVTA run fixed route from, and which takes most of the evening wave? | Operations |
| Q2 | Where do relief operators check in when their run ends at a relief point? Can they reach a kiosk? | Operations |
| Q3 | Does MVTA IT manage Android Enterprise in Intune today? If not, enabling it (a managed Google Play binding) is a one-off IT step | MVTA IT |
| Q4 | Can Avail supply an operator roster (logon ID, active or inactive), so PINs follow hires and leavers without waiting for a pull-out? | Avail |
| Q5 | Can Avail's pull-out report carry relief runs as separate rows? Today run = block on almost every row | Avail |
| Q6 | Which languages do the contractor's operators read? | Keolis |
| Q7 | Do the kiosk accounts need any Entra licence for Conditional Access, under MVTA's agreement? | MVTA IT |
| Q8 | Do `count_source` and its sibling columns go into #457 before it merges, or into the operator app's first migration? | User |
| Q9 | For badge sign-in: new OnBoard NFC fobs, or the contractor's existing access badges? If the badges, which card technology are they (125 kHz proximity, iCLASS, Seos, DESFire)? | Operations, with Keolis |
| Q10 | Where do operator vehicle defect reports go today (paper, Keolis's maintenance system, an MVTA system), and who must receive one from the kiosk? | Fleet / Operations |

## Decisions this needs

**From the user:**

- Q8 (where the schema columns land).
- Device trust option B (kiosk account plus the app-owned role
  `operator-kiosk`), as input to the operator credential ADR.
- Renaming #458's `ridership-operator-admin` to `operator-credential-admin`
  (§3.3), and building the operator site as a module shell from the first
  release (§8).
- Badge sign-in: ship ID + PIN first, with the session built to take a badge
  later (§3.6).

**From Operations:**

- Q1, Q2, Q9 and Q10.
- Two kiosks per garage, and placement.
- Ownership (step 2).
- The pilot targets in §6.

**From MVTA IT:**

- The tablet model, with Android decided (§2), and Q3.
- The kiosk accounts, Conditional Access and Intune enrolment (steps 6, 7
  and 10).
- Patching ownership and Q7.
