# Operator Sign-in — Logon ID + PIN

Date: 2026-11-02. **Not implemented.** The user accepted all ten of its
decisions on 2026-11-02, each as recommended (see *Decisions*, below). The
questions for Operations, MVTA IT, the contractor and Avail are still open.
Code waits for the operator credential ADR (§6.5).

This evaluates how operators sign in to the operator app: the garage kiosk
first, then operators' phones once OPR-038 is amended. It settles what the
earlier designs left open:

- how PINs are issued, stored, reset and locked out;
- how the operator roster is kept.

It does not reopen these agreed decisions:

- no hardware on buses, and no MDT change;
- the kiosk first, phones only after OPR-038 is amended;
- sign-in with the Avail logon ID + PIN;
- the operator picks the run, then enters totals, with no automatic trip
  detection;
- a submission replaces the paper sheet, except during a pilot.

Scanned Count Sheet upload is evaluated in a separate session and is not
covered here.

**References.** "D7", "D8" … are decisions in `plans/ridership-operator-app.md`
(PR #458). "Eval §3.2" is `plans/operator-kiosk-evaluation.md` and "P1"–"P6"
are the decisions in `plans/operator-kiosk-module-shell.md` (both PR #461).
"Hardware §4" is `plans/operator-kiosk-hardware.md` (PR #462). "Ops brief" is
`plans/operator-app-ops-discussion.md` (branch
`claude/operator-app-ops-features-aa1898`). "Spec §10" is
`plans/ridership-counting-spec.md`.

**What the earlier designs already say, and this document keeps:**

| Source | Rule |
|---|---|
| D7 | Avail logon ID + a 6-digit OnBoard PIN, on kiosk and phone alike. No Entra account per operator |
| D8 | The check-in desk issues a one-time PIN, which the operator changes at first sign-in. 5 wrong tries lock the PIN until the desk resets it |
| D9, P1 | Kiosk: "anything else?" for 15 s after a submission, then sign out; 2 min of no touch signs out. Phone: one service day |
| Eval §3.2 | Each kiosk is its own non-person Entra account, let in by Conditional Access only from an Intune-compliant device, holding the app-owned role `operator-kiosk`. The operator session sits on top. The API requires both |
| Eval §3.3 | `ridership-operator-admin` renamed `operator-credential-admin`, because the PIN signs in to every kiosk module, not only ridership |
| Eval §3.6 | Ship logon ID + PIN; build the session call to accept a badge number in place of the logon ID later |
| P5 | Detours go live at the pilot garage before Ridership, as a soft launch. **So PINs are needed before ridership is**: issuance happens at the soft launch |

## Summary

- **Roster.** Avail's logon ID is a good key on today's evidence: it is
  one-to-one with a name across 81 days of pull-out. But OnBoard should key
  operators by its **own operator number** and hold the logon ID as an
  attribute, because Avail has not said that an ID is never reused, nor that
  IDs survive the contractor change on 2027-01-01. The roster is an
  **OnBoard table**, filled in two ways (§1.4, added at the user's request):
  - a **CSV or Excel upload** of first name, last name, Avail logon ID and an
    assigned PIN, for go-live and for batches of new hires;
  - **Add operator**, one at a time with the same fields, the way a person is
    added elsewhere in OnBoard.

  An assigned PIN is a **starting PIN**: the operator must change it at first
  sign-in, and it expires if unused. Pull-out history is a cross-check, not
  the source. The contractor tells the desk about leavers, and a monthly
  check catches the ones it forgets. There is no automated HR feed.
- **PINs.** 6 digits, chosen by the operator after a one-time PIN from the
  desk. Hashed with **scrypt, a per-PIN salt and a server-held pepper** in Key
  Vault, so a copy of the database alone cannot be brute-forced. There is no
  periodic expiry. Resets happen **in person at the desk only**, with no
  self-service. 5 wrong PINs lock it, and each kiosk has its own failure
  limit.
- **Session.** Keep eval §3.2's kiosk account. Make the operator session an
  **opaque, server-side session** (a random token whose hash is a row in SQL),
  not a signed token. Sign-out and revocation then take effect at once, and
  there is no signing key to manage.
- **Phones later:** the PIN **plus a one-time enrolment of the phone at the
  garage**, which binds a passkey or a device key to the operator. A PIN
  alone on the open internet is not enough when the IDs are 3–4 digits. If
  Operations chooses MVTA-issued devices mounted on the bus (the ops brief's
  recommendation), enrol those like kiosks instead.
- **Identity strength.** A PIN can be shared. That is acceptable for counts
  and for the contractor-level compliance occurrence (spec §8), because the
  occurrence falls on the contractor whoever pressed Submit. It is **not**
  acceptable as evidence against an individual operator. OnBoard should
  record "submitted with logon ID X's PIN at kiosk K", and the procedure
  should say so.
- **Build:** five new tables, one deep `operatorAuth` module in
  `functions-restapi`, the operator session endpoints, and an Administration
  page *Operator sign-in* gated by the role `operator-credential-admin`.

## Facts from the dev database (read 2026-11-02)

Read-only aggregates from `dbo.FixedRouteDepartures`, Avail's pull-out
report. No IDs or names were copied.

| Fact | Value | Why it matters |
|---|---|---|
| Window held | 2026-08-14 to 2026-11-02, 81 days, 10,197 rows | Enough history to see churn, not a year of it |
| Distinct logon IDs | **236** (Aug 184, Sep 209, Oct 204) | About 240 PINs to issue at full rollout; a pilot garage is a share of that |
| Distinct operator names | 236. **No ID has two names, and no name has two IDs** | The logon ID behaves as a stable person key within this window |
| Column type | `logon_id INT`. 233 IDs have 4 digits, 3 have 3 digits, none are non-numeric | Store it as an integer. An ID with a leading zero in Avail would lose it here, so the kiosk pad must compare numbers, not strings |
| Rows with no logon ID | 1,083 (10.6%) | Pull-out cannot always say who drove, so it cannot be the only roster source |
| IDs first seen after 2026-09-15 | 36 | Arrivals: new hires, returns from leave, extra-board operators |
| IDs not seen in the last 30 days | 36 | Absence from pull-out is noisy. It cannot be the leaver signal on its own |
| IDs seen on 3 service days or fewer | 47 | Many operators drive rarely. A short inactivity rule would lock them out |
| Names that match a non-person word filter (training, extra, spare, test, super…) | 1 | One logon ID may be shared or generic. A shared ID must never hold a PIN |
| Name format | All "Last, First" | Used only for the "not you?" check after sign-in |
| Other tables holding an operator ID | `RidershipSheets.operator_id` (`NVARCHAR(20)`, "logon_id, or as written on the sheet") | OCC entry already stores the ID as text. Kiosk rows should store the same value so the two read alike |

Logon IDs are short and dense. With 236 of at most 10,000 four-digit values
in use, about one random guess in 40 is a real ID. Knowing an ID is
therefore not a secret, and the PIN plus the device gate carry the security.

## 1. The operator roster

### 1.1 Is the logon ID a stable unique key?

**Within Avail, today, yes.** It is one-to-one with a name over 81 days, with
no conflicts either way.

**What is not known:**

- **Reuse.** Does Avail ever give a leaver's ID to a new hire? Many CAD/AVL
  systems allow it.
- **The contractor change on 2027-01-01.** Do operators who move to Keolis
  keep their logon IDs, or does Keolis renumber them?
- **Shared IDs.** One name in pull-out looks like a generic login (training,
  extra or similar).

**Recommendation:**

- Key every operator record by an **OnBoard operator number** (an identity
  column) and hold the **logon ID as an attribute**. It is unique among
  **active** operators only.
- If Avail reuses an ID, the old operator is deactivated and a new operator
  is created. Their submissions, sign-ins and PIN history never merge.
- On every record that names an operator (`RidershipSheets`,
  `RidershipCountHistory`, the auth events), keep both:
  - the logon ID as entered, for people reading the record;
  - the operator number, for joins.
- Never issue a PIN to a shared or generic ID. The desk marks it
  *not a person* on the Operator sign-in page; an upload or Add operator
  refuses that ID.
- Ask Avail and Keolis the three questions above (§7 steps 1 and 2).

### 1.2 Where the roster comes from

| Source | For | Against | Use |
|---|---|---|---|
| **Avail pull-out history** (`FixedRouteDepartures`) | Already in OnBoard, refreshed every poll. Proves the ID drives MVTA service | A new hire is missing until their first pull-out. 10.6% of rows have no ID. A leaver lingers until a cut-off, and absence is noisy (36 of 236 unseen in 30 days) | **Cross-checks** the roster, sets *last seen*, and drives the inactivity rule |
| Avail operator roster endpoint (eval Q4) | Authoritative active/inactive status from the system the IDs live in | Not known to exist. `lib/availClient.ts` calls none | Use it if Avail has one; it replaces most of the monthly check |
| A contractor HR feed (automated) | Authoritative hires and leavers | Brings HR data (employee numbers, dates of birth, home garage, status codes) into a public-repo system that needs none of it. A feed to build and keep running, which changes owner on 1/1 | **No feed.** |
| **An uploaded roster file** (CSV or Excel, §1.4) | One upload loads a whole garage at go-live, from a list the contractor already keeps. Only four columns | Someone has to prepare it. If it carries PINs, it is a sensitive file until they are changed (§1.4) | **The way to load operators in bulk** |
| **Add operator** (one at a time, §1.4) | The same four fields in a form, for a new hire | One at a time | **The way to add a new hire** |
| **OnBoard-maintained table** | One place that says who may hold a PIN, with who added or removed them and when | Someone has to keep it | **The roster.** Filled by the upload and Add operator, edited only by the desk and MVTA |

**Recommendation:** an OnBoard table `Operators` is the roster, filled by
upload or by Add operator (§1.4).

- **Pull-out is a cross-check.** Each operator on the roster shows *last seen
  in Avail*. A report lists logon IDs seen in pull-out in the last 60 days
  that are **not** on the roster, so a missed operator is noticed.
- **A new operator not yet in pull-out** can be added. The row shows *not yet
  seen in Avail* until it appears there. If it has not appeared in 30 days,
  it is listed in the monthly check. This replaces D8's "only logon IDs in
  Avail's operator data", which would stop a new hire using the kiosk in
  their first week.

### 1.4 Adding operators: upload a file, or one at a time

Added 2026-11-02 at the user's request.

**The file.** It is CSV or Excel (`.xlsx`), one row per operator, with these
columns:

| Column | Required | Rule |
|---|---|---|
| `first_name` | Yes | Text, up to 100 characters |
| `last_name` | Yes | Text, up to 100 characters |
| `avail_logon_id` | Yes | Digits only, as in Avail (3–4 digits today) |
| `pin` | No | Exactly 6 digits and passes the PIN rules (§2.1). Left blank, OnBoard generates one |

- The page offers a **template** to download with these headers, and with
  the ID and PIN columns already formatted as text.
- Excel drops leading zeros, so a PIN typed as `012345` becomes `12345`. A
  PIN that is not 6 digits is **refused, not padded**, with the message
  "PIN must be 6 digits — format the column as Text."
- Other columns are ignored and never stored, so a contractor's export with
  extra HR columns does no harm.

**How the upload works:**

1. The file is **read in the browser**. Only the parsed rows go to the API,
   so the file itself is never uploaded or stored.
   - The console reads no Excel today. This needs a maintained `.xlsx`
     reader. The npm `xlsx` package stopped at 0.18.5 and has known
     advisories, so use SheetJS's own current release or `read-excel-file`.
   - CSV needs no new dependency.
2. **Preview.** The API checks every row and changes nothing (a dry run).
   Each row shows one outcome:
   - *new*;
   - *already on the roster, no change*;
   - *name differs from the roster* (it will update);
   - *name differs from Avail's pull-out* (a warning);
   - *logon ID belongs to another active operator* (refused);
   - *duplicate ID in the file* (refused);
   - *missing or bad field* (refused);
   - *PIN breaks a rule* (refused, with the rule).
3. **Confirm.** The user loads the valid rows. Refused rows are listed to fix
   and upload again.
   - An upload never removes or disables anyone. Leavers stay a separate,
     deliberate act (§1.3).
   - It never replaces the PIN of an operator who already has one. Use
     **Reset PIN** for that.
4. **Audit.** One event for the batch (who, when, file name, row counts) and
   one per operator added or changed. The PINs are never in either.
5. **PINs generated for blank rows** are shown once, as a printable list of
   slips (logon ID, name, PIN), and are never shown again.

**Add operator** is the same four fields in a form, on the same page. It
works the way a person is added in Access & Identity, but it is a separate
list: operators have no Entra account and no OnBoard role. With the PIN left
blank, OnBoard generates one and shows it once.

**Every assigned PIN is a starting PIN**, whether it came from a file, from
the form or from OnBoard:

- the operator **must change it** at their first sign-in, before Home opens;
- it **expires 14 days** after it was set if unused. That is longer than a
  desk-issued 72 hours, because handing out a whole garage takes more than a
  shift. After that, the desk resets it.

This is what makes a list of assigned PINs acceptable. Whoever prepared the
file knows every starting PIN, but none of them is anyone's PIN for long.

**What this changes from the in-person design:**

- **Identity check.** The desk no longer checks photo ID as each operator is
  added. The check moves to **whoever hands out the PIN**. The contractor
  gives each operator their own PIN privately: on a slip, in person, never
  posted or sent in a group message. This goes in the procedure (§7
  step 10).
- **The file is sensitive** while it holds unchanged PINs. The procedure
  says:
  - prepare it on a contractor or MVTA computer, not a personal one;
  - never email it;
  - delete it once it has been uploaded and the slips handed out.

  Leaving the `pin` column blank, so that OnBoard generates the PINs, avoids
  a PIN file existing at all. Only the printed slips remain. **This is the
  recommended way to use the upload.** The PIN column is there for a
  contractor that has already given its operators PINs.
- **Who may upload.** Holders of `operator-credential-admin` (the desk and
  the garage manager) and MVTA access administrators. One action covers
  both upload and Add operator. A bulk upload is a bigger act than one
  reset, so the monthly report (§4.3) lists every upload.

**Recommendation:**

- build the upload (CSV and `.xlsx`, a template, a dry-run preview) and Add
  operator;
- every assigned PIN is a starting PIN: changed at first sign-in, and it
  expires after 14 days;
- prefer a blank PIN column, so that OnBoard generates the PINs and prints
  slips;
- an upload adds and corrects, but never disables or overwrites a PIN.

### 1.3 Who adds and who deactivates

| Event | Who | How |
|---|---|---|
| Add (an existing operator at go-live, or a new hire) | The garage desk or garage manager (`operator-credential-admin`), or MVTA | Upload a roster file, or Add operator (§1.4) |
| Leaver | **The contractor tells the desk the same day**, and the desk disables the operator | Disable on the Operator sign-in page, with the reason *left*. Written into the procedure (§7 step 10) |
| Leaver the contractor forgot | **Monthly check** | On the first working day of each month the page lists active operators not seen in pull-out **and** not signed in for 30 days. The desk confirms each one with the contractor's garage manager: still employed (keep) or left (disable). The confirmation is recorded |
| Long absence, nobody acted | Automatic | Disabled after **90 days** with no pull-out and no sign-in. The 30-day figure above shows that a shorter rule would catch operators on leave. Re-enabling is a new one-time PIN at the desk |
| Shared or generic ID | The desk or MVTA | Marked *not a person*; can never hold a PIN |
| Suspected misuse | MVTA (an access administrator) | Disable at once; the desk reissues after the contractor has looked into it |

**The contractor change on 2027-01-01.** The kiosk pilot starts no earlier
than after the March 2027 month close (D24), and the detour soft launch (P5)
comes just before it. So **no PIN exists on 1/1**, and every PIN is issued
under Keolis. That removes the hardest case, credentials that outlive their
employer. What remains:

- the desk staff who hold `operator-credential-admin` will be Keolis staff;
- the roster records which **agreement** each operator was enrolled under
  (the `agreement_id` used elsewhere in OnBoard). At a later contractor
  change, all of the outgoing agreement's operators are disabled on the last
  day, and the incoming contractor reloads them with new starting PINs (§1.4). Nobody's PIN passes
  across an employer boundary unchecked.

**Recommendation:** as above. The roster is OnBoard's, loaded by upload or
Add operator, checked against pull-out, and the contractor answers a monthly
leaver check. No automated HR feed.

## 2. PINs

### 2.1 Length, and who chooses it

| | Assigned, kept | **Chosen by the operator** after a starting PIN |
|---|---|---|
| Who knows it | Whoever assigned it or prepared the file, and anyone who saw the slip | Only the operator |
| Memorability | Poor; it ends up written on the badge | Better |
| Desk effort | One issue per operator | The same issue, plus nothing |
| Weak choices | None | Possible, so a blocklist is needed (below) |

**Recommendation: keep D7 and D8.** 6 digits, chosen by the operator after a
starting PIN. The starting PIN comes from the desk, an upload or Add
operator (§1.4). An assigned PIN may be used to start, never kept.

- 6, not 4, because a PIN is long-lived (unlike a rider's 24-hour SMS code),
  and the step from 10⁴ to 10⁶ costs about one second at the pad.
- Not longer, and not letters: a numeric pad with gloves (eval §5), and
  operators also key their logon ID.
- Allowed **only** with the device gate. An online guess needs a kiosk.

**Rules on a chosen PIN.** These are checked on the server, and the reason
is shown plainly:

- not all one digit (`000000`, `111111` …);
- not an ascending or descending run (`123456`, `654321`, `012345` …);
- not a repeated pair or triple (`121212`, `123123`);
- not the logon ID, padded or repeated;
- not the one-time PIN just issued, and not the operator's previous PIN;
- not on a short list of the most-used PINs (around 20 entries, such as
  `112233` or `147258`, the pad's columns). The list is a file in code.

**Reusing another PIN.** OnBoard cannot know an operator's Avail MDT
password, bank PIN or phone code, so it cannot enforce "not reused". The
PIN screen, the card at each kiosk and the procedure say *choose a PIN you
use nowhere else*. Avail's MDT sign-in is the logon ID, so an operator who
reused it would be reusing something already known. Do not ask operators
for their Avail credentials to compare against.

### 2.2 First-time setup

Operators loaded by upload or Add operator (§1.4) already have a starting PIN
on a slip, valid for 14 days. They go straight to step 3. The steps below are
the desk's way, for one operator in person, and are also how a reset works.

1. The operator goes to the desk. The desk finds them on the roster,
   or adds them (§1.4), and checks the contractor's photo ID
   against the name.
2. The desk presses **Issue PIN**. The page shows a random 6-digit one-time
   PIN **once**, in large type, with the operator's logon ID.
   - It is drawn with `crypto.randomInt`, as rider SMS codes are
     (`lib/confirmationTokens.ts`).
   - It is valid for **72 hours** and for one sign-in.
   - It is never emailed, texted or printed. OnBoard holds no contact
     details for operators, and keeps it that way.
3. The operator signs in at the kiosk with the logon ID and the one-time
   PIN, then **must** choose their own PIN, entered twice, before Home opens.
   Best done there and then, in front of the desk.
4. If the 72 hours pass unused, the one-time PIN stops working and the desk
   issues another.

At go-live (the detour soft launch, P5), the pilot garage's operators are
loaded by upload in the week before, and their starting PINs are handed out
privately as they come in for their shifts (§7 step 9).

### 2.3 Storage

- **scrypt** (Node's built-in `crypto.scrypt`; no new dependency), with a
  random 16-byte **salt per PIN**. A starting cost of N = 2¹⁵, r = 8, p = 1
  takes 32 MB and tens of milliseconds. Measure it on the B1 plan before
  fixing it; 8 sign-ins in the peak 15 minutes (eval facts) is no load.
- **A pepper.** The PIN is first keyed with HMAC-SHA-256 using a secret held
  in Key Vault (`OPERATOR_PIN_PEPPER`, versioned), then scrypt-hashed. This
  matters more for a 6-digit PIN than for a password. There are only a
  million PINs, so anyone holding a copy of the table, the salt and the hash
  could try them all for one operator in about a day of one CPU, slow hash or
  not. With the pepper, a copy of the database alone is useless. The pepper
  is never in the database, the repo or an app setting value. It reaches the
  app as a Key Vault reference, like the other secrets.
- Store the algorithm, its parameters and the pepper version with each hash,
  so a later change re-hashes at the next successful sign-in.
- Compare with `crypto.timingSafeEqual`, as `lib/spareWebhookPolicy.ts` does.
- **Never** store, log, return or display a PIN after it is set. The
  one-time PIN is stored hashed in the same way, and shown only in the
  response that issues it. App Insights traces carry the logon ID and the
  device, never the request body of a sign-in call.
- No API returns a hash, a salt or a failure count to anyone; the desk sees
  only a state (§2.4).

Rider SMS codes are stored as plain text (`SubscriberConfirmations.token`).
That is fine for a code that lives 24 hours and is used once. It is **not**
a precedent for PINs.

### 2.4 Resets

**Not self-service.** A self-service reset needs a second channel to prove
who is asking: an email address, a phone number, a security question. OnBoard
holds none of these for operators, and should not collect them only for this.
A reset is therefore **in person at the desk**, by the contractor's garage
staff who hold `operator-credential-admin` (the check-in desk or the garage
supervisor).

- The desk checks the contractor's photo ID, then presses **Reset PIN**. This
  issues a new one-time PIN (§2.2). It also clears a lockout and ends any open
  session for that operator.
- **Forgotten PIN** and **locked PIN** are the same reset.
- **MVTA** (access administrators, and System Administrators who hold every
  action under ADR 0032) can also reset, disable and enable. That covers a
  desk that is unstaffed, or a desk user who is themselves an operator.
- **A desk user cannot reset an operator record linked to their own
  person.** The `Operators` row carries an optional link to an OnBoard person
  for staff who are also operators. When it is set, the API refuses the
  self-reset, and MVTA does it instead.

The risks of contractor staff holding resets are in §4.3.

### 2.5 Lockout and rate limits

| Limit | Rule | Why |
|---|---|---|
| **Per operator** | 5 wrong PINs in a row lock the PIN until the desk resets it (D8). A correct PIN sets the count back to 0 | 5 guesses in 10⁶ is a 1 in 200,000 chance |
| **Per kiosk** | 10 failed sign-ins in 10 minutes, across any IDs, pause that kiosk's sign-in for 5 minutes and raise a warning on the health page (eval §3.4) | Catches someone at the screen working through IDs, which the per-operator limit cannot see |
| Per operator, speed | A sign-in for an ID that failed in the last 2 seconds is refused before the hash is checked | Stops a scripted burst from one kiosk using up an operator's 5 tries in a moment |
| Unknown ID | Counts against the kiosk, not against any operator | |
| A one-time PIN | The same 5-try rule. A locked one-time PIN needs another issue | |

**The deliberate-lockout risk.** Anyone at a kiosk could lock out a colleague
by keying their ID 5 times with wrong PINs. The kiosk limit slows that down,
the auth events show which kiosk did it and when, and the remedy is a reset
at the desk a few metres away. Accept it for the kiosk. A temporary lock
(say 15 minutes, then a hard lock at 10) would mean fewer trips to the desk,
at the cost of more guesses. Keep D8's hard lock for the pilot and look at
the lock count after it.

**What the operator is told.**

- A wrong PIN and an unknown ID give the same message: *"Logon ID or PIN not
  recognised."*
- A lock is shown as *"PIN locked — see the desk."* That does reveal that the
  ID exists. On a device-gated kiosk where IDs are guessable anyway, that is
  accepted, because an operator who does not know why they cannot sign in is
  worse.
- The operator's name appears only **after** a correct PIN (the "not you?"
  check, eval §4.1), never after the ID alone. Otherwise the kiosk would
  serve as an ID-to-name lookup.

### 2.6 Expiry

- **No periodic expiry.** Forced periodic changes make people pick weaker,
  predictable PINs and write them down. Current NIST guidance (SP 800-63B)
  advises against them.
- A PIN is changed when there is a reason: a reset, suspected misuse, or a
  change of pepper or algorithm (the last needs no action by the operator).
- A PIN stops working when the operator is disabled: a leaver, the
  monthly check, or 90 days unused (§1.3).
- The operator can change their own PIN at any time from Home. That needs
  the current PIN.

**Recommendation:** §2.1–2.6 as written.

## 3. Session and device

### 3.1 How the kiosk authenticates

Eval §3.2 compared four options. This document takes its recommendation,
**option B**:

- each kiosk is a non-person Entra **kiosk account**;
- Conditional Access admits it only from an Intune-compliant device
  (hardware §4.3), with a named-location fallback if Chrome on a dedicated
  device cannot show compliance (hardware §4.6);
- the account holds the app-owned role `operator-kiosk` with one action,
  `operator-kiosk.use`, and its grant records the kiosk's garage.

The other options are not reopened:

- a service principal per garage with a certificate needs a packaged app,
  because a browser page cannot run client credentials;
- mutual TLS is fiddly on SWA, Front Door and Functions, and OnBoard has none
  today;
- a **registered device token**, a random secret given to each kiosk at
  enrolment, would work but adds nothing over B. It is a secret in browser
  storage that Intune does not protect and Entra cannot revoke.

**The operator sign-in sits on top.** Every operator endpoint requires
`operator-kiosk.use` through the existing `requireAccess`
(`lib/access/require.ts`). Every endpoint except sign-in also requires a
valid operator session. Neither is enough alone.

### 3.2 The operator session

Eval §3.2 sketched an OnBoard-signed token that lives 5 minutes.
**Recommendation: an opaque server-side session instead.**

| | Signed token (JWT) | **Opaque session** |
|---|---|---|
| Sign-out, reset, disable | The token works until it expires | Takes effect at the next call: the row is closed |
| Keys | A signing key to create, store, rotate | None. The token is 32 random bytes; SQL holds only its SHA-256 |
| Each call | No database read | One indexed read. The operator calls already read SQL, so this adds little |
| Idle timeout | Needs refresh tokens or reissue | `last_seen_at` on the row |

How it works:

- `POST /api/operator/session` returns the token. The page keeps it in
  memory and `sessionStorage` (cleared at sign-out, eval §3.4) and sends it
  as `Authorization: OperatorSession <token>`. The kiosk's Entra token keeps
  travelling in its usual header, so the two never collide.
- The row records the operator, the **device** (the kiosk account's Entra
  object id), the garage, the channel (*kiosk* or *phone*) and the times.
- **A session is bound to its device.** A token presented with another
  kiosk's Entra identity is refused and the session is closed.
- **Kiosk timing:**
  - **idle:** 2 minutes with no call ends it on the server. The page warns at
    1:40 (eval §3.4). The page sends a light keep-alive on touch, so reading
    a long detour does not time out;
  - **absolute:** 20 minutes from sign-in, whatever happens. A run with 12
    trips (the maximum, eval facts) takes a few minutes to key;
  - **after Submit** (D9, P1): the page shows "Submitted ✓ — anything
    else?" with the module tiles and a large Sign out button for 15 seconds.
    Any touch keeps the session. No touch signs out, and the page closes the
    session on the server, so a closed session never relies on the page
    alone.
- **Phone timing:** one service day (D9). The session ends at 03:00 Central
  after the service date it began on, between the end of service at
  midnight and the start at 04:00. The phone must also stay enrolled
  (§3.3).
- **One kiosk session per operator at a time.** Signing in at a second kiosk
  ends the first, which avoids a session left open at a screen someone walked
  away from. Phone and kiosk sessions may coexist.

### 3.3 Phones later: PIN alone, or PIN plus enrolment

On a phone there is no kiosk account. If the sign-in endpoint were open to
the internet with a PIN alone, anyone anywhere could try one PIN against
each of about 240 guessable IDs. That stays under each ID's 5-try limit, and
locks real operators out on purpose (eval §3.2).

| | **PIN alone** | **PIN + one-time device enrolment** |
|---|---|---|
| Who can try a PIN | Anyone on the internet | Only an enrolled phone |
| Lockout attack | From anywhere, at scale | Only from an enrolled phone, which is traceable |
| Lost phone | Nothing to revoke | The desk revokes that phone |
| Operator effort | None | One visit to the desk, once per phone |
| Build | Small: an anonymous endpoint with IP limits | Medium: enrolment and passkey endpoints |

**Recommendation: the PIN plus one-time device enrolment.** The phone
becomes the second factor that the kiosk's Intune compliance is today.

1. At the desk, the operator signs in with their logon ID and PIN on their
   phone's browser. The desk shows a **one-time enrolment code** (a QR code
   plus 8 characters, valid for 10 minutes) on the Operator sign-in page.
2. The phone presents the code and creates a **passkey** (WebAuthn, a
   platform authenticator unlocked by the phone's own screen lock), which
   is registered to the operator. Where a phone cannot make a passkey, the
   fallback is a non-extractable WebCrypto key kept in the browser's
   storage. That is weaker, because clearing site data loses it, but it is
   still bound to that browser.
3. Each later sign-in is the passkey **and** the PIN. The passkey also stops
   phishing: a fake site cannot use it.
4. At most 2 phones per operator. The desk and MVTA can see and revoke them.
   A disabled operator's phones are revoked with them.

The enrolment and passkey endpoints are the only anonymous operator
endpoints. They take a desk-issued code that lives 10 minutes, and they are
rate-limited per code and per client address.

**If phones are MVTA-issued.** The ops brief recommends MVTA-issued devices
mounted at the farebox and staying with the bus, rather than personal phones.
Those would be enrolled in Intune like kiosks, with a device account and the
`operator-kiosk` grant. The kiosk path would then serve them unchanged, and
none of this section would be needed. Which device class phone mode uses is
the ops brief's question O2. Build §3.3 only if the answer is personal
phones.

## 4. Threats

### 4.1 Shoulder-surfing at a shared kiosk

- PIN digits are shown as dots, with no enlarged key-press highlight and no
  "show PIN" button. The number pad is the shell's own, and the system
  keyboard never opens.
- **Do not scramble the pad.** A scrambled pad defeats someone watching the
  finger's position, but it slows everyone down, fails people with low
  vision and gloves, and breaks WCAG 2.2 consistency. The kiosk is used by
  people who know each other, for low-value actions.
- **Placement** (hardware §2): the screen faces a wall or sits in a hood, and
  there is a floor mark for the next in line about 1.5 m back. Hardware §2
  already sets the angle and the glare film. A privacy film is not advised:
  it narrows the viewing angle that ADA placement needs.
- **Badge + PIN later** (eval §3.6 option 2) takes away the observed logon ID
  and leaves an observed PIN useless without the badge.

### 4.2 One operator submitting for another

A PIN proves that whoever keyed it **knew** it, not that they **are** that
operator. PINs will be shared: a colleague keys in someone's counts as a
favour, or a regular pair share at the end of a shift.

**For counts, this matters little.**

- The count is checked by other means: the scanned sheet is compared trip by
  trip (D20), and there are outlier flags (spec §6) and APC comparison
  (spec §12).
- A count keyed by the wrong person is still the run's count, and is either
  right or caught.
- D15 already lets any operator on the run add trips.

**For compliance occurrences, it matters little too.** Spec §8's Incident and
Data Reporting occurrence is raised against **the contractor**, for a missing
or late sheet. Who pressed Submit does not change whether the sheet arrived
on time. The contractor's liability is the same.

**It does matter if a submission is used against an individual operator**,
for discipline over a late or false count. A PIN is weak evidence of who
acted. **Recommendation:**

- OnBoard's records say **"submitted with logon ID NNNN's PIN at Garage A
  kiosk 2"**, never "submitted by (name)".
- The procedure says PINs are personal and must not be shared, and that
  OnBoard's records **identify a credential, not a person**. Action against
  an individual is for the contractor's own process, which can ask the
  operator.
- Modules where an operator **attests** something later, such as a vehicle
  condition report's "safe to operate", need a stronger factor: badge + PIN
  (eval §3.6), or a passkey on an enrolled phone. Decide when that module is
  designed.

### 4.3 Contractor staff resetting PINs

A desk user can issue a one-time PIN for any operator and sign in as them
before the operator does. The PIN gives no access beyond what the operator
has: their own runs and messages. But it would let a desk user submit a
run's counts under someone else's ID.

Controls:

- **The reset tells the operator.** At their next sign-in, Home shows *"Your
  PIN was reset on Thu 6 Nov at 17:42 by the desk at Garage A."* An
  operator who did not ask knows at once. The same banner shows the last
  sign-in time and kiosk on every Home ("Last signed in: yesterday 17:42,
  Garage A kiosk 2").
- **A reset ends sessions** and makes the old PIN useless, so an operator
  whose PIN was reset without asking finds out the next time they sign in.
- **Every desk action is audited** with the desk user's OnBoard person, the
  time and the garage (§4.4).
- **A monthly report to MVTA** lists every upload and Add operator, resets
  by desk user, and any **reset
  followed within 30 minutes by a sign-in at a kiosk other than the one by
  the desk**, or by a submission for a run the operator was not on. These are
  unusual, not proof, and MVTA reviews them (§7 step 12).
- No self-reset (§2.4), and the procedure requires a photo ID check.
- Desk users never see a PIN after the one-time PIN screen, and never see a
  hash.
- **Uploaded or assigned PINs** are known to whoever set them. They are
  starting PINs only: changed at first sign-in, and they expire in 14 days
  (§1.4). A sign-in with a starting PIN at a kiosk away from the operator's
  garage is in the monthly report.

### 4.4 Audit trail

Every submission is tied to an operator:

- `RidershipSheets` and `RidershipCountHistory` get `entered_by` /
  `changed_by` = `operator:<logon ID>` (eval §4.2), **plus** the operator
  number and the session id. Through the session, each submission leads to
  the operator, the device and the time of sign-in.
- **`OperatorAuthEvents`** records, for each event, the time, the device and
  garage, the operator number (when known), the logon ID as typed (also for
  unknown IDs), the outcome, and the desk user for admin events. The events
  are:
  - sign-in success, wrong PIN, unknown ID, locked, rate-limited, kiosk
    paused;
  - sign-out, with the reason (button, idle, after-submit, absolute, replaced
    by another kiosk, reset);
  - PIN set, changed, one-time issued, reset, expired;
  - operator enrolled, disabled, enabled, marked not a person;
  - phone enrolled or revoked.
- **Retention:**
  - sign-in and sign-out events: **13 months** (eval §4.3), enough for a
    year's comparison and the month close;
  - credential and roster events (issue, reset, disable): as long as the
    ridership records they could affect, under MVTA's records retention
    schedule. Records manager to confirm (§7 step 13).
- The events table is written only by the `operatorAuth` module, and no
  endpoint edits or deletes a row, following the access audit pattern of
  ADR 0032.

### 4.5 Data minimisation

**OnBoard holds about an operator only:**

- the logon ID;
- the name as Avail spells it;
- the agreement they were enrolled under;
- the status and when it changed;
- the PIN hash;
- for phones, the passkey's public key.

No phone, email, employee number, date of birth or home address, and nothing
from HR.

| Who | Sees |
|---|---|
| **The operator**, signed in | Their own name (for "not you?"), their runs today, their own submissions, their last sign-in and any reset of their PIN, their enrolled phones |
| **Anyone at the kiosk before sign-in** | Nothing about any operator. No names, no "recent IDs" list, no autocomplete |
| **The desk** (`operator-credential-admin`) | The roster: logon ID, name, status (*active*, *one-time PIN issued*, *locked*, *disabled*), date last seen in pull-out, date of last sign-in. Not the full sign-in history, and no PINs or hashes |
| **MVTA access administrators** | The roster, the full auth events and the monthly report |
| **Everyone else in OnBoard** | Nothing from these tables. Operator names on ridership records stay under spec §10's rule: recorder, manager and compliance roles only |
| **Nobody** | A PIN after it is set; a hash; a failure count (only *locked* or not) |

Operators should be told what is recorded (module shell step 5): their
sign-ins, the kiosk used, and when.

## 5. Alternatives

| Alternative | Why not, or not yet |
|---|---|
| **Logon ID + a printed badge or QR card, no PIN** | One factor: possession of a card that is lent, lost or photographed. A QR code can be copied by a phone camera in a second. Fine for **pre-filling** the logon ID; never a sign-in on its own |
| **NFC badge or fob + PIN** (eval §3.6 option 2; hardware §5) | **The planned upgrade, not a replacement.** Removes keying the ID and adds a possession factor. The session call takes a badge number in place of the logon ID from the first release, so it is a register and a configuration, not a rebuild. Decide after the pilot |
| NFC badge alone (eval §3.6 option 3) | The same weaknesses as a QR card; cheap NFC tags copy easily. Not for any module that submits or attests |
| **Entra B2B guest per operator** | About 240 guest accounts for MVTA IT to create and remove, following a contractor's hires and leavers. Guests need an email address, which many operators do not have at work. MFA would push a personal phone, which OPR-038 bans on duty. A shared kiosk would carry a person's Entra session, which is the hard case for shared device mode. Already ruled out in D7 |
| An Entra member account per operator (a "kiosk user" with no mailbox) | The same lifecycle burden as B2B, in MVTA's own directory. A P1 licence for Conditional Access on each account. A password policy that does not fit a 6-digit PIN |
| **Entra External ID** (a customer-identity tenant) | The strongest "don't build it ourselves" option. Microsoft would hold hashing and lockout, and there is a free tier for this many users. But its sign-in methods are email with password or one-time code, or social and phone sign-in. It has no numeric-PIN-plus-desk-reset model, operators have no email, and it adds a second tenant to run. Revisit for phones if personal-phone mode grows beyond a pilot |
| Reusing the Avail MDT credential | Avail offers no sign-in service OnBoard can call, and checking an operator's Avail password in OnBoard would make OnBoard hold it |

**Recommendation:** logon ID + PIN now, with the badge as the planned
upgrade. The rest are not pursued.

## 6. Build shape in OnBoard

### 6.1 Tables (one migration)

| Table | Holds | Key points |
|---|---|---|
| `Operators` | `operator_id INT IDENTITY`, `logon_id INT`, `first_name`, `last_name`, `agreement_id`, `status` (`active`, `disabled`, `not_a_person`), `source` (`upload`, `form`), `import_batch_id NULL`, `first_seen_service_date`, `last_seen_service_date`, `linked_person_id NULL` (staff who are operators), created/disabled by, at and reason | A filtered unique index on `logon_id WHERE status = 'active'`. "In pull-out, not on the roster" is a view over `FixedRouteDepartures`, not rows. `OperatorImportBatches` (who, when, file name, row counts; never the file or PINs) sits beside it |
| `OperatorCredentials` | One row per operator and kind (`pin`; `badge` later): `secret_hash`, `salt`, `algo` (`scrypt-hmac-v1` with N, r, p), `pepper_version`, `state` (`one_time`, `active`, `locked`), `one_time_expires_at`, `failed_count`, `last_failed_at`, `locked_at`, `set_at`, `last_success_at`, `previous_hash` (for "not your last PIN") | Written only by `operatorAuth` |
| `OperatorSessions` | `session_id`, `token_hash` (SHA-256, unique), `operator_id`, `device_principal_id`, `garage`, `channel` (`kiosk`, `phone`), `created_at`, `last_seen_at`, `absolute_expires_at`, `ended_at`, `end_reason` | Closed rows are kept 13 months with the events |
| `OperatorDevices` | **Phones only, later:** `operator_id`, WebAuthn credential id and public key (or the WebCrypto key), a label, `enrolled_at` and `enrolled_by`, `revoked_at` and `revoked_by` | Not in the kiosk release |
| `OperatorAuthEvents` | §4.4's events | Append-only. The per-kiosk limit is a count over this table by device for the last 10 minutes, indexed on `(device_principal_id, at)` |

### 6.2 One module, `functions-restapi/src/lib/operatorAuth/`

A deep module with a small interface, so that hashing, lockout, the
blocklist and the session rules live in one place and are tested there:

```ts
signIn({ logonId | badge, pin, device, garage, channel }) → session | refusal
resolveSession(token, device) → operator | refusal      // every operator call
endSession(token, reason)
changePin(session, currentPin, newPin) → ok | rule broken
issueOneTimePin(operatorId, deskPerson) → the PIN, once
disable / enable / markNotAPerson(operatorId, deskPerson, reason)
```

Refusals are values, not exceptions, and say only what the operator may be
told (§2.5). The pepper is read once per cold start from the Key Vault
reference.

### 6.3 Endpoints

All `/api/operator/*` endpoints need `operator-kiosk.use` (the device), and
all except `POST session` also need the operator session. These sit beside
the module endpoints in eval §4.1 and module shell §6.

| Endpoint | Does |
|---|---|
| `POST /api/operator/session` | Logon ID (or later a badge number) + PIN → session token, the operator's display name, and whether a PIN change is required |
| `DELETE /api/operator/session` | Sign out, with a reason |
| `POST /api/operator/session/keepalive` | Touch, for the idle timer |
| `GET /api/operator/me` | Name, last sign-in, recent PIN events, enrolled phones |
| `POST /api/operator/pin` | Change own PIN (current + new). The only call allowed while a change is required |
| `GET /api/admin/operators?status=&q=` | The roster, and IDs in pull-out not on it |
| `POST /api/admin/operators` | Add operator: first name, last name, logon ID, optional PIN → a generated PIN shown once if blank |
| `POST /api/admin/operators/import?dryRun=true\|false` | Rows parsed in the browser from CSV or `.xlsx` (§1.4). A dry run returns each row's outcome; a real run loads the valid rows in one transaction and returns any generated PINs once |
| `POST /api/admin/operators/{operatorId}/pin` | Issue or reset → the one-time PIN, once |
| `POST /api/admin/operators/{operatorId}/disable`, `…/enable`, `…/not-a-person` | Roster changes, with a reason |
| `GET /api/admin/operators/monthly-check` | Active but unseen for 30 days, for the desk to confirm |
| `GET /api/admin/operators/events` | The auth events and the monthly report. Access administrators only |
| Later, phones: `POST /api/admin/operators/{operatorId}/enrolment-code`, `POST /api/operator/devices/enrol`, and the WebAuthn challenge and verify calls | §3.3 |

### 6.4 The admin screen and its role

- **Administration → Operator sign-in**, listed once in `adminNav.ts`, a
  console page as Planning's ridership setup is (spec §10). It is not in
  Access & Identity: desk staff must not see that area.
- It has three tabs:
  - **Roster**: search by logon ID or name; the status; **Add operator**,
    **Upload roster** (template, preview, confirm), Issue/Reset PIN, Disable,
    Enable;
  - **Not on the roster**: seen in pull-out in the last 60 days, not on the
    roster;
  - **Monthly check**.
- Access & Identity links to this page for access administrators, so
  operators are found where people are, without desk staff seeing Access &
  Identity.
- The one-time PIN appears in a dialog that cannot be reopened, with
  *"Give this to the operator in person. It works once, for 72 hours."*

**Role.** One new app-owned role (ADR 0032), as the module shell and eval
§3.3 proposed:

| Role | Actions | Held by |
|---|---|---|
| **`operator-credential-admin`** ("Operator Credential Admin") | `operator-credentials.view`, `operator-credentials.manage` | Named check-in desk and garage supervisor staff at each garage. Likely the same people who hold `ridership-printer` (migration 159) |

- A third action, `operator-credentials.audit` (the events tab and monthly
  report), is held by Access Administrator and System Administrator, not by
  the desk.
- **Grants are agency-wide** (ADR 0032). A desk can reset any garage's
  operator, which suits operators who move between garages. Every action
  records the desk user's garage, and the monthly report shows resets across
  garages. Garage-scoped grants would need ADR 0032's reserved `scope`
  column to be used for the first time. Not worth it for a one-garage pilot.
- This replaces `ridership-operator-admin` in PR #458's step 5. That PR
  should be updated to match.

### 6.5 An ADR first

The operator credential is new authentication alongside Entra. It needs its
own ADR before code (#458 step 4; eval §7 step 14). Its proposed title
is *Sign operators in with a logon ID and PIN on top of a kiosk identity*,
and this document is its input. Its decisions would be:

- the OnBoard operator number as the key;
- a peppered scrypt hash;
- an opaque, device-bound session;
- PINs only behind a device gate;
- a credential identifies a credential, not a person.

The terms *Operator*, *Operator PIN*, *One-time PIN*, *Operator session*,
*Candidate operator* and *Phone enrolment* go into `CONTEXT.md` with it.

## 7. Steps outside the code (numbered, owner in brackets)

These add to eval §7 (kiosk accounts, Conditional Access, Intune and the
`operator-kiosk` role, its steps 6–10), which are prerequisites and are not
repeated here.

1. **Ask Avail:**
   - Is a logon ID ever reused after an operator leaves?
   - Are any logon IDs shared or generic (training, extra board)?
   - Is there an operator roster endpoint with active/inactive status (eval
     Q4)?

   [User, to Avail]
2. **Ask Keolis:**
   - Do operators keep their Avail logon IDs from 2027-01-01, or are they
     renumbered?
   - Who staffs each garage's check-in desk and supervision, by name, for the
     pilot garage?
   - Will the garage manager answer a monthly "still employed?" check by
     logon ID?

   [Operations, with Keolis]
3. **Write the operator credential ADR** (§6.5) and add the terms to
   `CONTEXT.md`, before any code. [Engineering]
4. **Create the pepper secret** `OPERATOR_PIN_PEPPER` in the dev and prod Key
   Vaults, give the REST app's identity read access, and wire it in as a Key
   Vault reference. The value is generated in Key Vault and never seen by a
   person or written to the repo. [Engineering + MVTA IT]
5. **Seed the role `operator-credential-admin`** with
   `operator-credentials.view` and `operator-credentials.manage` by
   migration, and give `operator-credentials.audit` to Access Administrator.
   This is ADR 0032's registration step: there is no Entra app-role
   registration for an app-owned role. [Engineering]
6. **Assign `operator-credential-admin` to named desk staff at the pilot
   garage.** This is two parts, both required:
   1. **In Entra:** invite each person as a B2B guest, unless they already
      are one for `ridership-printer`, and add them to the OnBoard Users group
      so sign-in is allowed. [MVTA IT]
   2. **In OnBoard:** grant the role to each person in Access & Identity, and
      record who and why. [An access administrator]
7. **Apply the migration on dev, then prod**, and check it in the schema
   drift panel. [User]
8. **Prepare and upload the roster.** The contractor fills the template with
   first name, last name and Avail logon ID for the pilot garage's operators.
   Leave the PIN column blank so OnBoard generates the PINs (§1.4). Upload it,
   fix any refused rows from the preview, and check the *Not on the roster*
   tab for anyone missed. Mark any shared or generic ID *not a person*.
   [Keolis garage manager, with the desk; MVTA Planning checks the preview]
9. **Hand out starting PINs at go-live**, in the week before the detour soft
   launch (P5).
   - Print the slips at upload. Give each operator their own slip privately,
     after checking photo ID, as they come in for their shifts. They set
     their own PIN at the kiosk there and then.
   - Starting PINs expire after 14 days. Track who has signed in on the
     Roster tab, and reset the rest.
   - Destroy unclaimed slips, and delete any roster file that held PINs.
   - The other garages follow the same way before their own go-live. New
     hires after that are added with Add operator.

   [Keolis garage management, with the desk]
10. **Procedure wording**, in `plans/ridership-counting-procedure-draft.md`
    and the kiosk SOP:
    - the PIN is personal; do not share it, write it on a badge, or use one
      you use anywhere else;
    - the desk checks photo ID before an issue or reset, and never asks for
      or writes down the operator's chosen PIN;
    - the contractor tells the desk about a leaver the same day, and the desk
      disables them;
    - the desk does the monthly check with the garage manager;
    - OnBoard's records show which credential was used, not who used it
      (§4.2);
    - report suspected misuse to MVTA.

    [Planning + Operations]
11. **OPR-038 amendment, for phones only** (#458 step 1), adding:
    - phone use for counting is voluntary;
    - a phone is used only after it is enrolled at the garage;
    - it is never used while the vehicle is in motion;
    - the PIN is not shared.

    If phone mode uses MVTA-issued devices instead (ops brief O2), the
    wording names the issued device, and §3.3 is not built.
    [Planning + Operations, after consulting the contractor]
12. **Monthly review** of the reset report and the auth events (§4.3) by a
    named MVTA owner. [Operations names the owner]
13. **Retention:** confirm with MVTA's records manager how long sign-in
    events (proposed 13 months) and credential events (proposed: as long as
    the ridership records) are kept. [Planning, with the records manager]
14. **Tell operators** what the kiosk records about them (module shell step
    5), including that resets are shown to them. [Operations, with Keolis]
15. **At any later contractor change:** disable the outgoing agreement's
    operators on its last day; revoke the outgoing desk staff's
    `operator-credential-admin` and `ridership-printer` grants in OnBoard and
    their guest accounts in Entra; grant the incoming desk staff (step 6);
    reload the operators by upload, with new starting PINs (steps 8–9). [Operations + MVTA IT + an access
    administrator]

## Decisions

**Decided by the user, 2026-11-02**, one by one, each as recommended:

1. The OnBoard operator number as the key, with the logon ID unique among
   active operators only (§1.1).
2. An OnBoard roster loaded by **CSV/Excel upload** (first name, last name,
   logon ID, optional PIN) or **Add operator**, checked against pull-out, with
   no automated HR feed. New operators may be added before their first
   pull-out (§1.2–1.4). This changes D8's "only logon IDs in Avail's operator
   data".
   - Every assigned PIN is a **starting PIN**: changed at first sign-in, and
     it expires after 14 days.
   - OnBoard generates the PINs and prints the slips by default. The PIN
     column stays optional, for a contractor that already has PINs (§1.4).
3. **Auto-disable at 90 days** with no pull-out and no sign-in, with a
   monthly check at 30 days (§1.3).
4. A **peppered** scrypt hash (§2.3).
5. **No self-service reset**, and no periodic expiry (§2.4, §2.6).
6. Keep D8's hard lock at 5 wrong PINs for the pilot (§2.5).
7. An **opaque server-side session** in place of eval §3.2's signed token,
   with a 20-minute absolute limit on the kiosk (§3.2).
8. Phones: the PIN **plus** a one-time enrolment with a passkey (§3.3).
9. Records name the credential, not the person (§4.2).
10. The role `operator-credential-admin`, agency-wide, replacing #458's
    `ridership-operator-admin` (§6.4).

Follow-on: PR #458's step 5 and its terms still name
`ridership-operator-admin`, and its D8 still says "only logon IDs in Avail's
operator data". Both should be updated to match decisions 2 and 10.

**Still open — from Operations:**

- That whoever hands out a starting PIN does it privately with a photo ID
  check, and that the desk does the monthly check (§1.3, §1.4).
- Kiosk placement against shoulder-surfing (§4.1).
- A named owner of the monthly reset review (step 12).
- Phone device class (ops brief O2). This decides whether §3.3 is built.

**Still open — from MVTA IT:**

- The pepper secret and its Key Vault access (step 4).
- B2B guest invitations for desk staff (step 6).
- Whether shared device mode passes compliance from Chrome (hardware §4.6).
  This decides between eval §3.2's compliant-device gate and the
  named-location fallback.

**Still open — from the contractor (Keolis):**

- Whether logon IDs carry over on 2027-01-01 (step 2).
- Named desk and supervisor staff per garage.
- Same-day leaver notice, and an answer to the monthly check.
- Telling operators what is recorded (step 14).

**Still open — from Avail:**

- Whether logon IDs are reused, which IDs are shared, and whether there is a
  roster endpoint (step 1).
