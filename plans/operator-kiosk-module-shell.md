# Operator Kiosk — Module Shell and Home Screen

Date: 2026-10-31. **Not implemented.** This is the software design for the
kiosk as a platform of operator functions, which
`plans/operator-kiosk-evaluation.md` §8 called for. Hardware is in
`plans/operator-kiosk-hardware.md` (PR #462). Decision numbers D1–D25 refer to
`plans/ridership-operator-app.md` (PR #458).

**Decided by the user, 2026-10-31:**

- **Sign in first.** The kiosk's idle screen is the sign-in screen and shows
  nothing operational. Everything, detours included, is behind the operator's
  sign-in.
- **After sign-in, the home screen is built for that operator.** It shows:
  - **all detours**;
  - **the operator's own detours**, on the routes they drive today;
  - **messages for that operator**.

  What appears there **can be customized**. §5 sets out how.

Everything else here is **proposed** and marked so. §9 lists what needs a
decision.

## 1. Flow

```
 Idle / sign-in ──► Home (for this operator) ──► a module ──► Home ──► Sign out
       ▲                                                         │
       └──────────── 2 min no touch, or Sign out ────────────────┘
```

1. **Idle / sign-in screen:**
   - shows the garage name, the time, a logon-ID pad and "or tap your badge"
     (evaluation §3.6);
   - shows no detours, messages or names.
2. **Sign-in:** logon ID (or badge) + PIN. One operator session covers every
   module (evaluation §3.2). A first sign-in forces the PIN change (D8).
3. **Home:**
   - the operator's messages and their own detours at the top;
   - the module tiles below, each with a one-line status;
   - their name and today's run from Avail in the header, with **Sign out**.
4. **A module** (Ridership, Detours, Messages, later Vehicle report) opens
   full screen with a **Home** button. Modules never sign the operator out by
   themselves.
5. **Sign-out:** on **Sign out**, or after 2 minutes with no touch (a warning
   at 1:40, D9). After a submission in any module, **proposed:** show
   "Submitted ✓ — anything else?" with the tiles and a large Sign out button
   for 15 seconds, then sign out. D9 says sign out after each submission, so
   this changes D9 (§9, P1).

## 2. Home screen

```
┌──────────────────────────────────────────────────────────┐
│ Garage A · Thu 6 Nov 17:42      Signed in: (name) · Run 041 │
│                                              [ Sign out ] │
├──────────────────────────────────────────────────────────┤
│ FOR YOU                                                  │
│  ● Important  Bus 1234 to bay 7 after pull-in    [ OK ]  │  ← message needing acknowledgement
│  ○ Uniform fittings Tue at the desk                      │
│  ◆ Your detour  Rt 436 NB — Cedar Ave closed at 140th    │  ← on a route the operator drives today
├──────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│ │ RIDERSHIP    │ │ DETOURS      │ │ MESSAGES     │       │
│ │ Run 041      │ │ 2 yours      │ │ 1 unread     │       │
│ │ 6 trips to   │ │ 7 in effect  │ │              │       │
│ │ enter        │ │              │ │              │       │
│ └──────────────┘ └──────────────┘ └──────────────┘       │
│ ┌──────────────┐                                         │
│ │ VEHICLE      │   (later module; hidden until switched  │
│ │ REPORT       │    on for this garage)                  │
│ └──────────────┘                                         │
└──────────────────────────────────────────────────────────┘
```

- **For you** lists, in this order:
  1. unacknowledged important messages;
  2. other unread messages;
  3. the operator's own detours.

  It shows at most 5 rows, with "See all" going to Messages or Detours.
- **Tiles** have a fixed order per garage (§5), each with a status line from
  its module. The Ridership tile shows the run's state: *6 trips to enter*,
  *Draft saved*, *Submitted 17:42* or *Entered by OCC*.
- **Nothing personal before sign-in.** Messages addressed to one operator
  appear only inside that operator's session.

## 3. Detours: all and yours

**Source.** OnBoard's Detour module already holds everything the kiosk needs:

- `Detours` and their status (`detourStatus.ts`: Active, Upcoming, Monitor,
  Recently finished, Expired);
- `DetourSegments`: one row per route and direction, with turn-by-turn
  `directions`;
- `DetourImages`.

No new detour data is needed. The kiosk is one more reader.

**All detours:**

- Active, plus Upcoming that start before the end of today's service day;
- grouped by route, newest first;
- each opens to its segments, directions and images.

**Your detours** are those that match the operator's routes for today:

1. The operator's runs today: `FixedRouteDepartures` rows with their logon ID
   on today's service date, plus the run they open in Ridership.
2. Those blocks' routes and directions from the Dispatch Log
   (`TripStartLog.route_short_name` + `direction_label`, which hold `NB`, `SB`,
   `EB`, `WB`).
3. Detour segments whose routes match.

**The route text needs a normaliser.** `DetourSegments.routes` is free text,
and dev holds both `"436 NB"` and `"480 North"`. Proposed:

- A small `detourRouteMatch` module reads a segment's text into
  (route, direction) pairs: North/NB/N → NB, and so on, and comma or "&"
  lists.
- A segment it cannot read still appears under **All**, never silently
  dropped. The Detour Register marks it *not matched to routes*, so OCC can
  fix the text.
- Structured route and direction columns on segments are a later cleanup, not
  a precondition.

**No Avail run found** (the operator has not logged in to the MDT yet, or
Avail shows someone else): *Your detours* says "We couldn't find your run in
Avail" and lists all detours. When the operator opens a run in Ridership,
*Your detours* uses that run.

**Acknowledgement**, proposed and optional per detour. OCC can mark a detour
*operators must acknowledge*. It then sits in *For you* with an **OK** button
until the operator taps it, and OnBoard records who acknowledged it and when.
This is evidence that operators were told, which paper notices cannot give.
It must be announced to operators first, because it is a record against each
of them (§9, P4).

## 4. Operator messages

**What exists today.** Operator messages go out on the Avail MDT, or appear as
detour entries whose number is the text "Operator Message" (migration 017,
none on dev today). Neither reaches an operator at the garage, and neither
records who read it.

**Proposed: a new `OperatorMessages` module in OnBoard.**

| Field | Meaning |
|---|---|
| Title, body | Plain text; body up to about 1,000 characters |
| Audience | **All operators**, **garage(s)**, **route(s)** (anyone driving the route today), **run on a date**, or **one operator** (by logon ID) |
| Shows from / until | Start and end; required, so nothing lingers |
| Priority | Normal, or **Important** (pinned at the top of *For you*) |
| Requires acknowledgement | Yes or no; Important messages default to yes |
| Linked detour | Optional; opens the detour |
| Author, created, withdrawn | Who wrote it and when; a withdrawn message is kept but hidden |

- **Written in the console** by OCC or dispatch, under a new module
  `operator-messages` with the actions `view` and `publish`. The audience
  picker previews how many operators a message will reach today.
- **Read on the kiosk:** each operator sees the messages whose audience
  includes them today.
  - The audience is resolved on the server at read time from their logon ID,
    their garage (from the kiosk), and their runs and routes (as in §3).
  - Read and acknowledgement are recorded per operator: logon ID, time and
    kiosk.
- **The console shows read and acknowledged counts** per message, and who has
  not acknowledged an Important one, so OCC knows whom to call.
- **Content rule, proposed for the procedure:** operational messages only.
  No discipline, pay or HR matters, which stay with Keolis's own channels,
  and no medical or personal details. Messages to one operator are visible
  only in that operator's session. They are personal data, kept for 13
  months, and appear in the audit log.
- **Not reused:** Rider Alerts. Riders and operators are different audiences
  with different approval rules. A detour's rider alert and its operator
  message stay separate records, linked through the detour.

## 5. Customization

The home screen is customized at three levels.

| Level | What changes | Who | How |
|---|---|---|---|
| **Per operator, automatic** | Their run, their detours, their messages, their Ridership status | Nobody: computed at sign-in | §3, §4 |
| **Per garage** | Which modules are on, tile order, and whether *For you* shows detours, messages or both | **Proposed:** an access administrator, in a *Kiosks* page beside the kiosk grants in Access & Identity (§9, P3) | A setting per garage; changes apply at each kiosk's next refresh |
| **Per operator, chosen** | **Language** (once a translation exists) and **text size** (normal or large) | The operator, from a button on Home | Stored against the logon ID, so it follows them to any kiosk |

**Not proposed:** operators rearranging their own tiles. On a shared device
used for a minute at a time, the same layout for everyone is easier to train
and support.

## 6. The module contract

Proposed. It follows the console's pattern: one list that every surface reads
(`adminNav.ts`), and a server catalog that is the only place access is defined
(`lib/access/catalog.ts`, ADR 0032).

**Server: an operator module catalog.** This is separate from the staff
`MODULES`, because operators are not Entra users and hold no Role Grants.

```ts
interface OperatorModule {
  key: "ridership" | "detours" | "messages" | "vehicle-report";
  label: string;
  channels: Array<"kiosk" | "phone">;      // proposed: declared now (§9, P2)
  homeCard?: (ctx: OperatorContext) => Promise<HomeCard>; // status line + "For you" rows
}
```

**Client: one module registry** in `frontend/packages/operator-app`. The tiles,
routes and Home read it, and nothing else lists modules.

```ts
interface OperatorModuleView {
  key: OperatorModule["key"];
  icon: OperatorIconName;
  route: string;                 // "/ridership", "/detours", ...
  component: React.LazyExoticComponent<React.FC>;
}
```

**The shell owns these:**

- the operator session;
- sign-in and sign-out, and the inactivity timer;
- the offline queue (D18);
- the on-screen number pad;
- strings and language;
- text size;
- the header and the Home button.

**Modules own** their screens and their API area. **Modules never import each
other**; anything shared moves into the shell.

**Folders:**

```
frontend/packages/operator-app/src/
  shell/        session, sign-in, timers, offline queue, number pad, strings, layout
  home/         Home screen, For you, tiles
  modules/
    ridership/  (first)
    detours/
    messages/
    vehicle-report/   (later)
```

## 7. API

Every operator call needs the kiosk account's `operator-kiosk.use` action
(evaluation §3.2). Every call after sign-in also needs the operator session.

| Endpoint | Does |
|---|---|
| `GET /api/operator/kiosk` | The kiosk's garage, enabled modules in order, home settings. Device only, before sign-in |
| `POST /api/operator/session` | Logon ID or badge + PIN → operator session (evaluation §3.2–3.6) |
| `GET /api/operator/home` | One call for Home: the operator's name and today's runs, *For you* rows, and each enabled module's status line. Each module's `homeCard` runs on the server, so Home costs one round trip |
| `GET /api/operator/detours?scope=mine\|all` | §3 |
| `POST /api/operator/detours/{id}/ack` | §3, when acknowledgement is required |
| `GET /api/operator/messages` · `POST /api/operator/messages/{id}/read` · `…/ack` | §4 |
| `PUT /api/operator/preferences` | Language, text size (§5) |
| `/api/operator/ridership/…` | As in evaluation §4.1 |
| Console: `GET/POST/PATCH /api/operator-messages`, `POST …/{id}/withdraw` | `operator-messages.publish`; read and acknowledgement counts with `view` |
| Console: `GET/PUT /api/admin/kiosk-garages/{garage}` | Per-garage module list and home settings (§5) |

## 8. Increments

1. **Shell, sign-in and Home** with the Ridership tile only. Goes into the
   ridership kiosk pilot (D24).
2. **Detours: all and yours.** This reads data OnBoard already has, plus the
   route normaliser. **Proposed option:** ship it to the pilot garage
   **before** Ridership, as a soft launch. Operators then learn to sign in
   and get PINs sorted while nothing depends on it yet (§9, P5).
3. **Operator messages:** console authoring, kiosk reading, read and
   acknowledgement.
4. **Preferences:** text size at once, language once a translation exists.
5. **Vehicle condition report:** its own design, once Fleet says where
   defects go (evaluation Q10).

## 9. Decisions still open (proposed answers)

| # | Question | Proposed |
|---|---|---|
| P1 | After a submission, sign out at once (D9) or show "Anything else?" for 15 s? | 15 s, then sign out. This changes D9 |
| P2 | Declare kiosk and phone channels per module now? | Yes, so phone mode later is a switch |
| P3 | Who switches modules and home settings per garage? | An access administrator, in Access & Identity → Kiosks |
| P4 | Record acknowledgements of detours and messages per operator? | Yes, optional per item, announced to operators first. Never used to assess individual operators beyond "were they told" |
| P5 | Detours before Ridership as a soft launch at the pilot garage? | Yes |
| P6 | May a message go to one named operator? | Yes, operational content only (§4 content rule) |

## 10. Steps outside the code (numbered, owner in brackets)

1. **Seed the module `operator-messages`** (`view`, `publish`) in the module
   catalog by migration, and decide which seeded roles receive it.
   [Engineering]
2. **Grant `operator-messages.publish`** through a role (new, or added to an
   existing OCC role) and assign it to named OCC or dispatch staff in Access &
   Identity. [An access administrator, with Operations naming the people]
3. **Enter each garage's kiosk settings** (modules on, tile order, *For you*
   contents) in Access & Identity → Kiosks before its kiosks go live. [An
   access administrator]
4. **Agree the operator message content rule** (§4) with Keolis and write it
   into the procedure. [Operations, with Keolis]
5. **Tell operators** what the kiosk records about them: sign-ins, message
   and detour acknowledgements, preferences. Do this before the pilot,
   alongside the labour step in the operator app design. [Operations, with
   Keolis]
6. **Clean up detour route text** that the normaliser marks *not matched to
   routes*, and keep to "route + NB/SB/EB/WB" for new detours. [OCC]

## Terms for `CONTEXT.md`

| Term | Meaning |
|---|---|
| **Kiosk module** | One operator function on the kiosk (Ridership, Detours, Messages …), shown as a tile on Home and switched on per garage. |
| **Home** | The screen an operator lands on after sign-in, built for that operator. |
| **Your detours** | Active or upcoming detours on the routes and directions of the operator's runs today. |
| **Operator message** | An operational message from OCC or dispatch to operators, addressed to all operators, a garage, a route, a run or one operator, read on the kiosk. |
| **Acknowledgement** | An operator's recorded "OK" on a message or detour that requires one. |
