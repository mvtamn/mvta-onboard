# Detour Communications — Implementation Plan

Turns the **Detour Communications Review** (17 September 2026) into a sequenced
build. The review is the decision record; this is the work.

**B9 and B15 were approved as redesigned on 2026-09-17.** They had been carried
as "pending approval, not built" in `detour-module-consolidated-plan.md` while
the feature was built anyway — the review documents that gap. What is approved
is the design below, not what stands in the code today.

---

## What is already built, and stays

Candidate #6 of the 2026-09-16 architecture review landed the enforcement layer,
and none of it is re-done here:

| Piece | Where |
|---|---|
| Eligibility decided in one place, enforced on both publish paths | `lib/detourCommunication/eligibility.ts`, `index.ts` |
| Console renders the decision; `mailto:` hidden while blocked | `routes/Detours.tsx`, `lib/detourCommunicationDraft.ts` |
| Delivery port with Teams, email and fake adapters | `lib/detourCommunication/delivery.ts` |
| One writer for delivery state (SQL fragment + TypeScript twin) | `lib/detourCommunication/state.ts` |
| Per-recipient receipts, frozen sent copy | migrations 092/093, `DetourDeliveryRecord.tsx` |
| Contract test over the real Detour migrations | `detourCommunication.db.contract.test.ts` |

## Decisions carried in from the review

1. **Channels**: email, SMS, Teams are *sent*; digital signage and AVL messaging
   are *recorded*. Radio is removed.
2. **Sender**: Microsoft Graph `sendMail` from a shared MVTA mailbox. ACS keeps
   rider alerts only.
3. **Recipients**: staff accounts, AD distribution groups, or the configured
   contractor addresses.
4. **SMS numbers**: Entra `mobilePhone`, never stored or edited in OnBoard;
   sent over the same ACS path and toll-free number as rider alerts.
5. **Recording is allowed on a closed detour**; sending is not.
6. **Riders are unchanged**: detour information reaches them through Avail/GTFS,
   per `CONTEXT.md` ("Avoid: public detour page, rider detour feed").

## The one decision still open

**Where required audiences come from for a feed-sourced detour.** 10 of 11
detours on dev arrived from the Avail sync with `notification_audiences` NULL,
so every one of them reads "Needs communication" with nowhere to send. Intake
typing is not the answer for records that never pass through intake. Increment 2
cannot start until this is settled; increments 1, 3 and 4 do not depend on it.

## Steps that are not code

These gate the increments that need them. All are the owner's.

| Step | Gates | Status |
|---|---|---|
| Migration 092 applied on dev | Any send at all | **Not applied** — verified 2026-09-17 |
| Shared mailbox + `Mail.Send` scoped to it | Increment 3 | Not started |
| Graph `User.Read.All` admin consent | Increment 5 | Not started |
| Toll-free number clears carrier verification | Increment 5 | Requested 2026-09-11, ~mid-October |

---

## Increment 1 — Named channels, and recorded channels

**No external dependency. Start here.**

`channel` is any non-empty string today (`validateDetourCommunication`), and the
intake form offers four chips plus free text. This increment makes the channel
set known and splits it into sent and recorded.

- A channel list in the module: `email`, `sms`, `teams`, `digital_signage`,
  `avl_messaging`, each declaring `sent` or `recorded`.
- Eligibility splits: **sending** keeps every refusal; **recording** keeps all
  but `detour_closed`. `recordSentElsewhere` takes the recorded path.
- Recipients are required only for a sent channel — publishing currently demands
  a recipients string for everything.
- A recorded communication carries **the date the message actually went out**,
  not only when it was typed, or a detour closed weeks ago reads as communicated
  weeks late.
- Migration: constrain `channel` to the known list, add the occurred-at column.
  Existing dev rows: none, so no backfill.

**Tests**: the channel table (sent vs recorded), the split eligibility rule, the
recipients rule, and a contract test recording a channel on a closed detour.

## Increment 2 — Audiences that work for feed detours

**Blocked on the open decision above.**

Whatever the policy is, it belongs in the module beside eligibility, not in the
intake form, so a detour from the Avail sync is judged the same way as one typed
by hand. "Needs communication" stops appearing on records that name no audience.

## Increment 3 — Email through Graph, formatted, with a link

**Blocked on the shared mailbox and its `Mail.Send` grant. Migration 092 must
also be applied.**

- A Graph adapter behind the existing `DetourDeliveryPort` — the port is already
  there, so this is a new adapter, not a new send path. ACS stays for riders.
- A formatted message built from the record, carrying a link to that detour on
  the Detours page.
- Staff preview and edit before sending; what is sent is frozen as today.
- Delete `subjectFor`'s duplicate of `communicationSubject`, and the stale
  "there is no server-side sender" comment in `detourCommunicationDraft.ts`.

**Tests**: the Graph adapter against a fake, the formatted body and link, an
edited draft sending what was edited rather than the template.

## Increment 4 — The console

Channel selector from the known list, recorded channels with their own flow (no
recipients, a date, allowed on a closed detour), preview and edit for email, and
the audience checklist reading whatever increment 2 settles.

## Increment 5 — SMS

**Blocked on the toll-free number and on `User.Read.All`. Build last.**

- Read `mobilePhone` from Entra at send time; never store it.
- An opt-out held in OnBoard against the person, since the number is not.
- Reuse the ACS SMS path that rider alerts use.
- A staff member with no `mobilePhone` receives nothing: say so in the record
  rather than failing silently.

---

## Sequencing

```
1 Named channels ──▶ 4 Console
2 Audiences ───────▶ 4
3 Email (Graph) ───▶ 4
                     5 SMS (last)
```

Increment 1 can start today. Increment 3 is the one the owner most wants and is
gated only by a mailbox. Increment 5 cannot be tested before mid-October.

## What this plan does not do

- It does not send anything to riders, or add a detour branch to the rider alert
  pipeline. That would reverse a documented decision.
- It does not build a signage integration: signage is recorded.
- It does not merge the two ACS senders in the dispatch app. Detour email moves
  to Graph, which leaves `dispatchDetourCommunication` handling only what is
  already queued; retiring it is a follow-up once nothing uses it.
