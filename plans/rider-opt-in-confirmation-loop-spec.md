# Closing the Rider Opt-In Confirmation Loop — Spec

Date: 2026-09-11. **Not implemented.** Written after 1.5.188 fixed the phone
format that stopped riders reaching the opt-in endpoint at all, which exposed
the larger gap behind it.

Inputs:

- `functions-restapi/src/functions/subscribersCreate.ts`
- `functions-restapi/sql/migration-002-subscriber-confirmations.sql`
- `functions-dispatch/src/functions/dispatchConfirmation.ts`
- `functions-dispatch/src/functions/dispatchMessageCreated.ts`
- `functions-dispatch/src/functions/acsEmailEvents.ts` — the pattern for an
  Event Grid webhook in this codebase
- `CURRENT_STATE.md` §7.2 (this gap), §7.3, §7.5

## The problem

Opt-in is a one-way door. `subscribersCreate` writes the subscriber
`pending_confirmation` and issues a token per channel; `dispatchConfirmation`
sends a 6-digit SMS code and an email linking to
`/api/subscribers/confirm-email?token=…`. **Nothing consumes either token.**
That URL has no function behind it, there is no inbound-SMS handler, and no
code anywhere writes `status = 'confirmed'`. `dispatchMessageCreated` selects
`WHERE status = 'confirmed'`, so the audience for every alert is permanently
empty.

`CURRENT_STATE.md` §7.2 has listed this since it was written. This spec is the
plan to close it, plus the three adjacent defects that cannot safely be left
open once riders start confirming.

## Four defects that must be fixed in the same pass

**1. Confirming email would make an unconfirmed phone SMS-eligible.**
`dispatchMessageCreated` gates SMS on `status = 'confirmed'` and email on
`status = 'confirmed' AND email_status = 'confirmed'`. `status` is doing double
duty as the record's overall state *and* as the SMS channel's state. A
subscriber who gives both contacts and confirms only the email link would, on
the obvious implementation, get `status = 'confirmed'` — and start receiving
SMS at a number nobody proved they control. That is the exact thing double
opt-in exists to prevent, and it is a TCPA exposure, not a cosmetic bug.

The fix is `sms_status`, mirroring `email_status`, with `status` reduced to the
record's lifecycle (`pending_confirmation` / `confirmed` / `opted_out`). Each
channel is then gated on its own column and neither can vouch for the other.

**2. A 6-digit code is globally unique by accident.** `UX_SubConfirm_Token` is a
UNIQUE index on `token`, and SMS tokens are `crypto.randomInt(0, 1_000_000)`.
Two pending SMS confirmations that draw the same code collide and the second
rider's opt-in fails with a 500. Rows are never cleaned up, so the pool of live
codes only grows. The uniqueness is also the wrong shape: a reply code is only
meaningful *for the number that received it*, and the lookup must be
`(phone_number, token)`, never token alone — otherwise a rider who guesses any
live code confirms somebody else's subscription.

**3. Nothing caps confirmation attempts.** The `attempts` column exists in
migration 002 and is never written. A 6-digit code with unlimited tries is a
6-digit code with no security at all.

**4. Duplicate contacts (CURRENT_STATE §7.5).** The phone and email indexes are
non-unique, so re-subscribing creates a second record. Today that is harmless
because nothing is ever confirmed. The moment confirmation works, the same
person gets every alert twice. Confirmation is the natural place to resolve it,
because that is the first moment the contact is *proven*.

## Design decisions

**Both callback endpoints live in `functions-restapi`, not the dispatch app.**
`Subscribers` and `SubscriberConfirmations` are the REST API's tables — every
other write to them is there — and putting both entry points in one app lets
the state machine be a single module with a single set of tests. The dispatch
app keeps its one job, sending. This differs from `acsEmailEvents`, which lives
in dispatch because it writes the detour-communication tables that dispatch
owns; the rule being followed is the same one, not a different one.

**The email link keeps its current URL and answers with a redirect.**
`GET /api/subscribers/confirm-email?token=…` is the URL already baked into
`dispatchConfirmation`, and confirmation emails may already be sitting in
inboxes. It stays, and answers `302` to
`${RIDER_APP_BASE_URL}/subscribe/confirmed?status=<outcome>` so the rider lands
on a page instead of a JSON body. The rider app's SWA config already rewrites
unknown paths to `index.html`, so the landing route needs no infra change.

`GET` for a state change is deliberate here and is the one place it is correct:
the rider's click *is* the request, and there is no opportunity to POST. The
token is single-use and expiring, which is what makes that acceptable. Note the
consequence — a mail scanner that prefetches links will confirm the
subscription. That is the standard trade for emailed confirmation links and is
the reason the SMS channel uses a code the rider must type.

**STOP is recorded even though ACS enforces it.** ACS maintains the opt-out
database for toll-free numbers automatically: a recipient who texts STOP is
added to it, and ACS will not deliver to them regardless of what OnBoard does.
So this is not the primary safety mechanism, and the urgency is lower than it
first appears. It is still required work, for three reasons: an SMS STOP says
nothing about that person's *email* subscription, which OnBoard must stop on
its own; the console's subscriber counts are wrong until OnBoard knows; and
every alert keeps attempting a send that ACS silently discards. Do not build on
the Opt-Out Management API — it is in preview.

HELP needs no handler. ACS answers mandatory keywords from the responses
registered in the toll-free campaign brief.

**Resends are capped by time, not by counter.** A rider who never got the code
needs a way to ask again; that path is also a free SMS-sending oracle if it is
unbounded. One resend per channel per 2 minutes, and the new token supersedes
the old rather than running alongside it.

## The build

Six increments. 1–4 are the loop and can each merge on their own; 5 and 6
depend on 1–4 being in.

### 1. Migration 117 — channel state, attempt tracking, opt-out

- `Subscribers.sms_status NVARCHAR(30) NULL` with the same CHECK as
  `email_status`. Backfill: `sms_status = status` where `phone_number` is not
  null, so existing rows keep their meaning.
- `Subscribers.opted_out_reason NVARCHAR(30) NULL` — `sms_stop`, `email_link`,
  `staff`. Without it, an opt-out cannot be told from an administrative one.
- `SubscriberConfirmations.last_attempt_at DATETIME2 NULL` and
  `superseded_at DATETIME2 NULL`.
- Replace `UX_SubConfirm_Token` with `UX_SubConfirm_Channel_Token`, filtered to
  live rows (`confirmed_at IS NULL AND superseded_at IS NULL`), on
  `(channel, token)`. A 6-digit code is then unique only among live SMS
  confirmations, and the collision that fails an opt-in becomes far rarer;
  `subscribersCreate` should still retry a duplicate-key insert two or three
  times rather than answering 500.
- Re-runnable, per `sql/README.md`. Number 117 is free as of this writing —
  check `main` before claiming it, and suffix rather than renumber on a
  collision.

### 2. `lib/subscriberConfirmation.ts` — the state machine

One module, no HTTP and no Azure types, so it is testable in isolation:

- `confirmByToken(pool, { channel, token, phoneNumber? })` → a discriminated
  result: `confirmed` / `already_confirmed` / `expired` / `not_found` /
  `too_many_attempts`. SMS lookups **must** pass `phoneNumber` and match on it.
- Increments `attempts` and sets `last_attempt_at` on every miss; refuses past
  5 attempts against one live token.
- On success, inside one transaction: set the channel's status, set
  `Subscribers.status = 'confirmed'`, set `opted_in_at`, and run the merge in
  increment 4.
- `optOut(pool, { channel, contact, reason })` — idempotent, and safe for a
  contact that matches no subscriber (ACS relays STOP from anyone).

### 3. `functions/subscribersConfirm.ts` — the two rider entry points

- `GET /api/subscribers/confirm-email?token=…` — anonymous, 302 to the rider
  app with the outcome in the query string. Never echoes the token back.
- `POST /api/subscribers/confirm-sms` — anonymous, `{ phone_number, code }`,
  for a rider who would rather type the code into the page than reply to the
  text. Normalizes the number through `normalizeUsPhone` (1.5.188) so it
  matches what was stored.
- `POST /api/subscribers/resend` — `{ phone_number? , email? }`, supersedes the
  live token, re-enqueues `confirmation-requested`, one per channel per 2
  minutes. Answers the same way whether or not the contact exists, so it cannot
  be used to test whether a number is subscribed.

### 4. Merge on confirmation

In `subscriberConfirmation.ts`, at the moment a channel confirms: if another
subscriber row already holds that contact on a confirmed channel, move this
row's categories and routes into it (union), mark this row superseded, and
return the surviving id. Other *pending* rows for the same contact are
superseded outright. This closes CURRENT_STATE §7.5 at the only point where the
contact is proven, and it is why §7.5 does not need its own unique index.

### 5. `functions/acsSmsEvents.ts` — inbound SMS

Modeled directly on `acsEmailEvents.ts`: an Event Grid webhook, `authLevel:
"function"` so the subscription URL carries the key, the
`SubscriptionValidationEvent` handshake handled first, parsing split into a
pure `lib/inboundSms.ts` that tests without Azure.

Handles `Microsoft.Communication.SMSReceived`. The body is classified after
trimming and upper-casing: a 6-digit code → `confirmByToken` scoped to the
`from` number; `STOP` / `UNSUBSCRIBE` / `CANCEL` / `END` / `QUIT` → `optOut`;
anything else acknowledged and logged, never auto-replied to. Always answers
200 — a non-200 makes Event Grid redeliver, and a redelivered STOP that throws
becomes an infinite retry.

### 6. Rider app — the landing page

`/subscribe/confirmed` reads `?status=` and says which of the five outcomes
happened, offering the resend endpoint on `expired`. The success copy must say
which channel confirmed and, when the other is still pending, that the other
still needs confirming — a rider who clicked the email link has no other way to
learn their phone is not done.

The opt-in success screen also gains a code box for the SMS channel, posting to
`confirm-sms`, so a rider can finish in the tab they are already looking at.

### Change to the dispatch predicate

Once `sms_status` exists, `dispatchMessageCreated`'s query becomes
`WHERE status = 'confirmed'` with SMS gated on
`sms_status = 'confirmed'` and email on `email_status = 'confirmed'`, each
channel standing on its own. Ship this **with** increment 1, not after: the
window in which `status = 'confirmed'` alone authorizes SMS is the window in
which defect 1 is live.

## What this needs from outside the code

1. **A toll-free number, and its verification.** Inbound SMS needs a number
   that can receive; the reply-code flow does not exist without one.
   Toll-free verification in the US is a carrier requirement, applied for
   through the ACS resource's **Regulatory Documents** blade, and Microsoft
   documents the aggregator review as **typically five to six weeks**. That is
   the long pole in this entire feature — start it the day the number is
   acquired, not when the code is ready. Unverified toll-free traffic is
   filtered and blocked rather than merely slowed. The campaign brief is also
   where the STOP/HELP auto-replies are registered, so its wording is a
   deliverable, not a formality.
2. **`ACS_SMS_FROM` must be declared in `infra-phase1/modules/functionapp.bicep`**,
   as a parameter with a value in the dev parameters file — not set with
   `az functionapp config appsettings set`. `ACS_ENDPOINT` was set that way and
   the next routine infra deploy erased it on 2026-09-05; the module's
   `appSettings` block is the complete desired state. `ACS_SMS_FROM` and
   `RIDER_APP_BASE_URL` are both still on the CURRENT_STATE §7.1 list of
   settings the template does not declare. Add both in increment 1's PR.
3. **An Event Grid subscription** on the ACS resource for
   `Microsoft.Communication.SMSReceived`, pointing at the dispatch app's
   `/api/acs-sms-events?code=<function key>`. A portal step, like the existing
   email-receipt subscription.
4. **Migration 117 applied to dev** by the user — dev SQL public access is
   Disabled and the server has no Entra admin for writes.

## Testing

- `subscriberConfirmation.test.ts` — the state machine against fakes: each
  outcome, the attempt cap, an expired token, a token replayed after success,
  an SMS code presented from the wrong number.
- `inboundSms.test.ts` — classification and the validation handshake, including
  `stop`, ` STOP `, `Stop please` (not a stop keyword — ACS matches exact
  keywords, and guessing wider is how a rider asking a question gets silently
  unsubscribed).
- A `*.db.contract.test.ts` for the merge and for migration 117, run against
  the CI job's real SQL Server. The filtered unique index and the backfill both
  read fine to a human and fail at apply time — migrations 106 and 116 both
  earned this the hard way.
- End-to-end on dev once the number is verified: subscribe, receive, reply,
  confirm, receive a real alert, text STOP, confirm the console's counts move.

## Out of scope

Per-route and per-zone selection (the question this investigation started
from), zone targeting and channel honoring in dispatch (CURRENT_STATE §7.3),
the transactional outbox (§7.4), and a full preference-management page. Route
selection in particular should wait for the preference page, since the first
wrong pick is otherwise unfixable — and the preference page wants the proven
contact and the token machinery this spec builds.
