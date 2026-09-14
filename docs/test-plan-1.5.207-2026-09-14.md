# Test plan — 1.5.198 → 1.5.207 (September 12–13, 2026 releases)

Two independent bodies of work landed:

- **Rider preference management** — increments A–E of
  `plans/rider-preference-management-spec.md` (1.5.198–1.5.203, 1.5.205).
- **Live-data honesty in the console** — Service Risk state, feed freshness and
  the live indicator (1.5.204, 1.5.206, 1.5.207).

They share no code. Test them in either order, but do the prerequisites first.

---

## 0. Prerequisites

### 0.1 Migrations

| Migration | Needed by |
| --- | --- |
| `migration-119-subscriber-manage-key.sql` | manage key, preference page |
| `migration-120-subscriber-manage-link-sent.sql` | manage-link throttle |
| `migration-086` (`KpiFeedHealth`) | `/trip-delays` feed ledger (1.5.206) |

Confirm 119's backfill gave **distinct** keys — the contract job asserts it, but
if you are looking at a database by hand, a single shared key would mean one
rider's link manages everybody's subscription:

```sql
SELECT COUNT(*), COUNT(DISTINCT manage_key) FROM Subscribers WHERE manage_key IS NOT NULL;
```

Both numbers must match.

### 0.2 Configuration

- `RIDER_APP_BASE_URL` set on the dispatch app, **https**, a plain origin and
  path. Case 5 covers what happens when it is not.

### 0.3 Automated evidence

| Area | Command |
| --- | --- |
| REST API | `cd functions-restapi && npm test` |
| DB contract jobs | `cd functions-restapi && npm run test:decision-matrix-contract` |
| Console | `cd frontend/packages/onboard-console && npm test` |
| Types | `cd frontend && npm run typecheck -w onboard-console` |

The contract list already includes `migration119`, `subscriberPreferences` and
`subscriberManageLink` — a failure there is more informative than any manual
case below.

---

# Part A — Rider preference management

## 1. Choosing a channel before typing contact details (1.5.198)

On the rider app's **subscribe** page:

1. **Expect** the form opens with *How do you want alerts?* — Text, Email, or
   **Both (default)** — and shows **only the fields that choice needs**.
2. Type an email address, then switch to **Text only**, then submit.
   **Expect** no email subscription is created. The address the rider took back
   is not sent.
3. Submit with a missing field.
   **Expect** the error **names the missing field and the choice to make
   instead**, appears in a panel above the button, marks the field for screen
   readers, and **clears as soon as you change something**.

**Layout and accessibility** (this release was half a design fix):

- The form **spans the card**, not 460px inside 670px.
- On desktop, **Both** puts the two contact fields side by side.
- Categories are a **four-column grid** (two on phones), with *MVTA Connect
  Delay* spanning two cells so rows come out even.
- Checkboxes are **18px in 40px rows**; fields are **16px** text (smaller and
  iOS Safari zooms the page on focus — check on a real iPhone).
- Every control has a **visible green focus ring**, orange on the selected
  channel. Tab through the whole form.
- At **375px wide**, the form is not squeezed to ~277px.

## 2. Choosing routes at signup (1.5.205)

1. **Expect** a *Which routes?* question under the alert types: **All routes**
   (default) or **Only the routes I choose**.
2. Choose two routes and sign up. Confirm the stored subscription has those two,
   not `"ALL"`.
3. Submit a route id that is **not offered** (via the API directly).
   **Expect** `400`, not a stored value dispatch will never match. Same for an
   **empty** list. `"ALL"` and a missing field behave as before.
4. `GET /api/subscribers/options` **anonymously** (no auth header).
   **Expect** it answers with the route and zone lists, reads nothing about any
   subscriber, and is cacheable for five minutes. It must **not** require the
   staff `GET /api/routes`.
5. **Break the options call** (block it in devtools) and reload the form.
   **Expect** signing up **still works**: *Only the routes I choose* is not
   offered, and a note says the rider can choose routes later from the link in
   any alert email.
6. **Expect** zones stay `"ALL"` at signup — they are offered on the preference
   page only, and only once a zone version is active.

## 3. The preference page (1.5.202, backed by 1.5.200)

Open `/subscribe/preferences#key=<manage key>`.

1. **The key leaves the address bar on arrival.** After load, the URL no longer
   carries it. Confirm it survives a **reload** (kept in `sessionStorage`,
   scoped to the tab) and dies when the tab closes.
2. **`?key=` is deliberately ignored** — try it and expect the no-key screen.
   The link format is `#key=`, because a fragment is never sent to a server:
   not to Front Door's or Static Web Apps' access logs, and not in a Referer.
3. A **malformed** key is treated as no key and must **not** fall back to a key
   stored from an earlier visit.
4. Change categories, routes, zones and channels; save; reload.
   **Expect** the change **assigns**, never unions — narrowing must work. This
   is most of why the page exists.
5. **Untick every route** and save.
   **Expect** refused. Routes and zones are *All* or *a chosen list*, never an
   emptied one — an empty list is neither "everything" nor "nothing".
6. Have a route **retired from the registry** on a rider's list.
   **Expect** it is taken off their list and they are **told so**, rather than
   being sent back and refused.
7. With **no active zone version**, expect zones are **not offered**, and a save
   sends the rider's stored zones back **unchanged** rather than resetting them
   to all.
8. Turn off **every channel**, or **every category**, and save.
   **Expect** you are pointed at **Unsubscribe** instead of saving.
9. **Unsubscribe.** Expect it asks once, opts the rider out, **rotates the key**,
   and records a reason. Then click the old link again: expect the
   link-no-longer-works screen. Click Unsubscribe **twice** overall — the second
   time is still success.
10. **A stopped channel** is shown, **disabled**, with a note that signing up
    again is the way back. Try to enable it through the API directly: expect
    `400` and **nothing written** — not "waiting for confirmation" (nothing
    would be sent to confirm it) and not confirmed (a link is not consent).
11. **A link mailed before a merge still resolves** — merge two records, then use
    the older link. Expect it reaches the survivor.
12. Confirm the key travels to the API in the **`X-Manage-Key` header**, never in
    a URL, and never as `Authorization: Bearer`.

## 4. The alert email footer (1.5.203)

1. Send yourself an alert.
   **Expect** a footer that **says why the email arrived** and links to the
   preference page.
2. Check the dispatch logs.
   **Expect** the link is **never logged** — it carries the manage key.
3. Unset `RIDER_APP_BASE_URL` (or set it to http, or to something that is not a
   plain origin and path) and send again.
   **Expect** the email goes **without a link**, and the dispatch app logs why
   **once per message, not once per recipient**. A footer that looks like a
   working opt-out but is not is worse than none.
4. **"Send me my link"** from the no-link and link-no-longer-works screens
   (`POST /api/subscribers/manage-link`):
   - Answers `{ status: "ok" }` for a **subscribed, unconfirmed, unknown,
     throttled and internally failed** contact alike — it must not be usable to
     ask whether a number is signed up. Try all five.
   - **Only a confirmed channel is ever sent a link.** Ask for a link on an
     unconfirmed contact: expect ok, and **no message sent**.
   - **Throttle:** ask twice inside two minutes. Expect at most one message
     (migration 120, `manage_link_sent_at`).
   - It rides the existing confirmation queue, told apart by `kind` — confirm
     the message does **not** arrive as *"your confirmation code is undefined"*.
5. **Deliberately absent, confirm rather than report:** the confirmation email
   does **not** carry the manage link, and `List-Unsubscribe` /
   `List-Unsubscribe-Post` headers are **not** set.

## 5. Zone-scoped dispatch (1.5.201)

1. Send a **zone** alert. Expect it reaches riders in that zone and riders who
   did not narrow, and **not** riders who narrowed to a different zone.
2. Send a **route** alert naming no zones. Expect the zone check passes everyone
   and only routes filter. Route and zone checks are **ANDed**; an alert naming
   nothing in a dimension is system-wide in that dimension.
3. Confirm the ids matched are **`external_location_id`**, not the UUID
   `zone_id` in `OnDemandRequestZoneSnapshots` — matching one space against the
   other would fail **silently**, delivering a zone alert only to riders who had
   not narrowed.
4. **"Unzoned"** (a pickup outside every zone) reaches only riders who did not
   narrow, and is never offered as a choice.
5. Store a malformed `{}` in a subscriber's audience column and send an alert.
   **Expect** that row reads as *no preference* and **the alert still reaches
   everyone after it**. Previously it threw out of the delivery loop and
   dead-lettered the message for every subscriber past that row.

---

# Part B — Live data honesty in the console

## 6. Service Risk states (1.5.204)

Check each of `TripDelayDiagnostics.state`:

| State | Expect |
| --- | --- |
| `current` | live banner, moving signal, countdown, poll bars |
| `no_current_trips` | **quiet muted banner, no sweep, badge "No active trips", signal still moving and counting down** — a live feed with nothing to report |
| `stale` | stale banner |
| `configuration_missing` | **the only red one** |

Before this, everything but `current` and `stale` fell through to the red
"unavailable" branch — so outside 8am–10pm service the banner drew a failure
glyph beside a full row of polls that had all arrived. **Check it after
service hours**, which is the only time this shows honestly.

1. On-Demand Service Quality's `no_active_service` gets the same treatment,
   **without** a countdown (that module keeps no refresh clock).
2. **Dispatch Log**: today's log now shows the live banner even with no warning
   message. An **earlier day** must **not** — it is a settled record and a
   countdown there would promise a refresh that is not coming.
3. On a **stale or failed** banner, the newest poll bar's **glow is flat**. The
   glow means an arrival; there the bar is only a record.

## 7. Feed freshness comes from the ledger, not the rows (1.5.206)

1. With `MonitoredTripDelays` **empty** and the feed **not answering**, load
   Service Risk.
   **Expect** `unavailable` (or `stale`), **not** `no_current_trips`. The rows
   cannot tell "the feed answered and nothing is running" from "the rows were
   cleared and the feed has not answered since", because `gtfsDelaysPoll`
   deletes rows after every successful fetch.
2. With the feed **answering inside its contract** and the table empty, expect
   `no_current_trips`.
3. With a database **without `KpiFeedHealth`**, expect `unavailable` rather than
   a guess.
4. **The ledger wins over freshly polled rows** — poll rows in while the ledger
   says the feed is stale, and expect the stale banner.
5. A **frozen vendor snapshot** that keeps refreshing rows is still caught (KPI
   trust ages a feed by its own header timestamp).
6. **While the feed is current**, rows past the limit are **left out** so the
   list agrees with the state. **While it is not**, the last known rows **stay
   visible** under a banner saying not to act on them.
7. **One limit per feed.** Confirm Service Risk, KPI trust and the
   `gtfsDelaysPoll` cleanup all read `lib/feedFreshness.ts`. **Service Risk's
   fixed-route limit moves from 10 to 15 minutes** — the old disagreement made
   the banner read Stale for about five minutes every night, then No current
   trips. The AVL "last 3 minutes" filters are vehicle recency and are
   deliberately **not** governed by this.

**Known and not fixed:** an empty feed during service hours still reads as
`no_current_trips`. Do not raise it as a defect.

## 8. The live indicator runs on the feed's clock (1.5.207)

The console re-reads `/trip-delays` every 30 seconds; the feed is polled every
five minutes. Nine re-reads in ten return the same data, and everything used to
animate on the re-read.

1. Watch the console for **more than five minutes**.
   **Expect** the countdown **unwinds once**, from the last real delivery to the
   next, and **restarts only when a delivery lands**. If the next delivery is
   late it **holds empty** rather than looping.
2. **Expect** the arrival flash and the banner sweep fire **once, when a delivery
   lands** — **not** on page load (the data was already there) and **not** on a
   re-read that returned the same delivery. Between deliveries the banner holds
   still; the halos still breathe while the feed is answering.
3. **Poll bars count deliveries, not re-reads.** Force a **failed console
   re-read** (block the request) and confirm it does **not** empty a bar — a
   failed re-read says nothing about the feed.
4. A **gap between deliveries fills missed slots**; time since the last delivery
   keeps adding empty bars while a stopped feed stays silent. A delivery is not
   counted missed until **half a cadence** late.
5. **Confirm `/trip-delays` returns `feed_last_success_at` and
   `poll_interval_minutes`,** and that the countdown's cadence matches the
   poller's schedule (a test holds them together).
6. **Mixed-build rollout:** point the console at a worker on the **previous**
   build, which answers without the two new fields.
   **Expect** **no countdown and no flash** — not a wrong one. This actually
   happened for ten minutes on 2026-09-14.

---

## Sign-off

| # | Case | Result | Notes |
| --- | --- | --- | --- |
| 1 | Channel choice at signup | | |
| 2 | Route picker at signup | | |
| 3 | Preference page | | |
| 4 | Alert email footer + manage link | | |
| 5 | Zone-scoped dispatch | | |
| 6 | Service Risk states | | |
| 7 | Feed ledger + one limit | | |
| 8 | Live indicator on delivery clock | | |

Cases 6–8 only tell the truth against a **real feed over real time** — an hour
spanning a service-hours boundary is worth more than any amount of clicking.
