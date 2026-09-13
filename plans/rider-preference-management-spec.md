# Rider Preference Management — Spec

Date: 2026-09-12. **Not implemented.** Written after the double opt-in loop
closed (`plans/rider-opt-in-confirmation-loop-spec.md`, all six increments
merged 2026-09-12), which was the thing that had to exist first.

Inputs:

- `functions-restapi/src/functions/subscribersCreate.ts` — the only place a
  rider's preferences are ever set today
- `functions-restapi/src/lib/subscriberConfirmation.ts` — `optOut`,
  `mergeOnConfirm`, `unionAudience`
- `functions-dispatch/src/functions/dispatchMessageCreated.ts` — `routeMatches`
- `functions-restapi/src/functions/routes.ts` — the route registry, staff-only
- `CURRENT_STATE.md` §7.3 (zones), migrations 117 and 118

## Why this, and why now

A rider sets categories once, at opt-in, and can never change anything again.
The opt-in form hardcodes `routes: "ALL"` and `zones: "ALL"`, so "the routes you
ride" in its own subtitle is not a thing anyone can express. There is no way to
stop email short of never reading it, and no way to stop anything at all except
texting STOP, which only governs SMS.

The question that started this work was whether to add route selection to the
subscribe form. The answer was no, not on its own, and the reason has since
hardened into a fact in the code: **`mergeOnConfirm` unions routes, zones and
categories** (increment 4). Re-subscribing is therefore the one
preference-changing gesture a rider has, and it can only ever widen what they
receive. A rider who picks three routes and later wants one cannot get there
from here. Adding a route picker to the subscribe form without this page would
ship a choice that is, in practice, irreversible.

## The four decisions

### 1. A durable manage key, not a confirmation token

Confirmation tokens expire in 24 hours and are spent on use. A preference link
lives in the footer of every alert and has to work in six months.

`Subscribers.manage_key` — 32 random bytes, base64url, issued at opt-in and on
demand. It is a bearer credential sitting in a rider's inbox, which is exactly
what every unsubscribe link in existence is; what makes that acceptable is
keeping its blast radius small:

- It authorizes changes to **one** subscriber's preferences and nothing else.
- The page shows the contact **masked** (`•••• 3275`, `t••••@gmail.com`). A
  found link must not become a way to read somebody's email address.
- It cannot change a contact. Adding or changing a phone number or address
  starts a fresh double opt-in, because the point of double opt-in is that
  nobody can sign up a contact they do not control - and a leaked manage key
  must not become a way to redirect someone's alerts to your own phone.
- It rotates when the rider asks, and on unsubscribe-all.

Do NOT use `subscriber_id`. It is a `NEWID()` GUID, it appears in staff-facing
responses, and it is not a secret.

### 2. The page assigns; it does not union

`unionAudience` is right there and is the wrong function to call. Merging two
records is a guess about what someone meant across two signups, so widening is
the safe direction. A rider editing their own preferences has said exactly what
they want, and narrowing is most of the point. `PUT` replaces.

### 3. Zones must be evaluated before zones can be chosen

Dispatch reads `Subscribers.routes` and the alert's `routes_affected`, and
ignores both zone fields (CURRENT_STATE §7.3). That is inert today because
every subscriber has `zones: "ALL"`. A zone picker would make it a lie: the
rider narrows, and receives everything anyway.

`routeMatches` already has the shape - `zoneMatches` is the same function over
the other column - so this is a small change that must simply not be deferred
past the picker.

### 4. Email carries the link; SMS does not

Alert email today is `<p>{summary}</p>` with no footer. It gains a manage link,
an unsubscribe link and a `List-Unsubscribe` header, because an opt-out
mechanism the rider can actually find is the consent promise the subscribe form
already makes on MVTA's behalf.

SMS does not. A URL costs segments on every alert to every subscriber forever,
STOP already works and is answered by ACS from the campaign brief, and the
recovery flow below covers a rider who only has a phone.

## The build

Five increments. A and B are the machinery; C is the page; D is how anyone
finds it; E is the honesty fix that must not lag C.

### A. Migration 119 — the key, and a record of what changed

- `Subscribers.manage_key NVARCHAR(64) NULL`, unique over non-null values, plus
  `manage_key_issued_at`. Backfill every existing row, since a subscriber
  without one cannot be sent a footer link.
- `SubscriberPreferenceChanges` — `subscriber_id`, `changed_at`, `source`
  (`rider_page` / `sms_stop` / `staff`), and the before/after of categories,
  routes, zones and each channel status as JSON. Audit tables in this codebase
  are per-module (`ProcedureAuditEvents`, migration 078); this follows that
  rather than inventing a general one.

  It exists for one scenario: a rider says they unsubscribed and kept getting
  texts. Without a row, that is unanswerable, and it is the kind of complaint
  that arrives with a regulator's letterhead on it.
- Re-runnable. 119 is free as of this writing - check `main` before claiming
  it, and suffix rather than renumber on a collision (`sql/README.md`).

### B. `lib/subscriberPreferences.ts` + the two endpoints

`resolveManageKey(tx, key)` returns the live subscriber, **following
`merged_into`** to the survivor. A link mailed before a merge still has to work,
and migration 118 made that reachable: bound the walk and treat a cycle as a
bad key rather than looping.

- `GET /api/subscribers/preferences?key=` — the masked contact, current
  categories/routes/zones, each channel's state, and the options to choose
  from. One call, so the page does not need a second unauthenticated endpoint.
- `PUT /api/subscribers/preferences?key=` — assigns. Rejects an empty category
  list (that is unsubscribing, and should say so), validates routes against the
  registry, and writes a `SubscriberPreferenceChanges` row.
- `POST /api/subscribers/unsubscribe?key=` — all channels, `opted_out_reason`
  `email_link`, and rotates the key so the dead link stops resolving.

**The route and zone lists ride on the `GET`,** rather than relaxing
`GET /api/routes` to anonymous. Route numbers are public on mvta.com, so this
is about not growing the unauthenticated surface with a registry dump, not
about secrecy.

### C. The rider page — `/subscribe/preferences`

Read the key from the query string and **replace it out of the URL**
(`history.replaceState`) once read, so it does not sit in the address bar to be
screenshotted or pasted into a support ticket.

Categories as today, routes and zones as grouped multi-selects, each with an
explicit "all" that is a real stored value rather than the empty set - "no
routes selected" must never silently mean "every route". Per-channel switches,
and an unsubscribe that asks once.

An invalid or rotated key gets the recovery flow, not an error page.

### D. How a rider finds it

- **Alert email footer** (`dispatchMessageCreated`): manage link, unsubscribe
  link, `List-Unsubscribe` and `List-Unsubscribe-Post` headers so a mail client
  can offer its own button - which is what a rider reaches for before they look
  for ours, and using it is much better for deliverability than the alternative
  gesture, which is marking the mail as spam.
- **Confirmation email** gets the same footer.
- **`POST /api/subscribers/manage-link`** - recovery. A rider enters a phone
  number or email; if it matches, the link is sent over that channel. It
  answers **202 identically whether or not it matches**, and is throttled per
  contact exactly like `resend`, for exactly the same two reasons: it is
  otherwise a way to ask whether a number is subscribed, and a way to make
  OnBoard text an arbitrary number on demand. `requestResend`'s throttle is the
  pattern to copy, not to re-derive.

### E. `zoneMatches` in dispatch

Closes CURRENT_STATE §7.3. Same shape as `routeMatches`: a subscriber on "ALL"
or with no preference matches everything; an alert with no zones is
system-wide; otherwise intersect. Ship with C, not after it.

## The one thing worth arguing about

**Whether the manage key should expire.** It should not, and the reason is
asymmetric harm. An expiring key means an unsubscribe link that stops working,
and a rider who cannot unsubscribe is a complaint with a regulator attached; a
long-lived key means a found link exposes a masked contact and the ability to
change preferences on it. The second is worth living with, the first is not.
Rotation on unsubscribe covers the case that actually matters - someone who has
left should not be re-enrollable from an old link.

## What this needs from outside the code

Nothing. No new Azure resource, no portal step, no carrier dependency. Every
increment can be built, tested and walked through on dev **as soon as
migrations 117 and 118 are applied** - which is still the outstanding step from
the previous spec, and blocks any end-to-end walkthrough of this one too.

The toll-free number is not on the critical path: the manage link travels by
email, and the SMS half of this spec is one `zoneMatches` call and a STOP that
already works.

## Testing

- `subscriberPreferences.test.ts` - masking, the assign-not-union rule, an empty
  category list, "all" versus empty.
- `*.db.contract.test.ts` - the key's uniqueness, resolution through a
  `merged_into` chain, a cycle, a rotated key no longer resolving, and that a
  `PUT` narrowing routes actually narrows them.
- `zoneMatches` beside the existing `routeMatches` tests, including the
  subscriber-on-ALL and alert-with-no-zones cases that make it inert today.
- A dispatch test proving a zone-scoped alert reaches a subscriber in the zone
  and not one outside it.

## Out of scope

Changing a contact in place (it is a new opt-in, by design); a rider-facing
delivery history; quiet hours; per-route severity thresholds. The transactional
outbox (CURRENT_STATE §7.4) remains open and is unrelated to this.
