# Detour Module Expansion — Vet & Implementation Plan

Companion to `detour-module-expansion-design.md` (the draft) and
`detour-module-consolidated-plan.md` (B1–B11, the shipped/approved baseline).

This document does two things:
1. **Vets** the B12–B17 draft against what is actually in the repo today.
2. Turns it into a **phased implementation plan** with the dependencies the
   draft doesn't yet account for.

Nothing here is built. Every phase below still needs explicit approval, per the
standing rule carried from the reporting spec.

---

## Part 1 — Vet against current code

### Ground truth: what is actually built

| Part | Draft assumes | Repo reality |
|---|---|---|
| B1/B2 | shipped | **Shipped.** `Detours`/`DetourSegments` (migration-017), full CRUD, `Detours.tsx` |
| B3 | attachments usable | **Code shipped, never executed.** `storage-detour-images.bicep` still not deployed — every image endpoint returns its 503 path |
| B4/B5 | Avail sync exists | **Shipped.** `availDetoursSync.ts`, 15-min timer, upsert by `external_detour_id` |
| B6/B7 | shipped | **Shipped.** migration-025 run against dev; `DetourReports.tsx`, client-side search/CSV |
| B8 (distribution lists) | draft treats as existing | **NOT BUILT.** No table, no endpoint, no admin UI |
| B9 (notify/send) | draft says B15 is "additive to B9" | **NOT BUILT.** No `detourNotify.ts`, no `DetourNotifications` table. Email mechanism (Graph vs SMTP/SendGrid) still an open decision |
| B10 (numbering) | — | **Shipped.** migration-024 run against dev; `backfill-detour-numbers-gap.sql` still pending post-deploy |
| B11 (`DetourAttachments`, PDF preview) | draft says "reuse `DetourAttachments` from B11" | **NOT BUILT.** Table is still `DetourImages`. There is no `DetourAttachments` |

**Migration head is 032**, not 025 as the consolidated plan states. Next new
migration is **033** — re-confirm at build time, other workstreams add them
concurrently.

---

### Finding 1 — Status-model collision (must resolve before anything else)

The draft's status list —

`Pending Review` → `Approved – Pending Avail Build` → `Built in Avail` → `Active – Disseminated` → `Expired`

— collides head-on with the shipped model. `functions-restapi/src/lib/detourStatus.ts`
computes `monitor | upcoming | active | recently_finished | expired` **purely from
dates**, and migration-017's own comment says status is "deliberately NOT a column
here" so the API and every future consumer share one definition. `Active` and
`Expired` appear in both lists meaning different things.

Also note `computeDetourStatus()` returns `"active"` for any non-monitor row with
no `start_date` — so a dateless workflow record would render as an Active detour
in `Detours.tsx`, `DetourReports.tsx`, and anything downstream.

**Resolution: two orthogonal axes, never merged.**

- `status` (existing, computed, date-derived) — *when* the detour is in effect.
- `lifecycle_state` (new, stored column) — *how far through the workflow* it is.

A detour is shown as live to any consumer only when
`lifecycle_state = 'built_in_avail'` **AND** `status = 'active'`. Neither axis
alone is sufficient, and neither is allowed to absorb the other. Proposed
lifecycle values: `approved_pending_build`, `built_in_avail`, `build_failed`,
`rejected`. (`pending_review` lives on the intake table — see Finding 2.)

This is a foundational change and should be its own part — call it **B18** and
build it first.

---

### Finding 2 — Intake table: repo evidence settles the draft's open question #1

The draft leans toward a separate `DetourIntake` table. The code agrees, for
three concrete reasons the draft doesn't cite:

1. **Numbering.** `detoursCreate.ts` allocates `MVTA-DET-YYYY-####` from
   `DetourNumberSequences` inside the insert transaction, and B10's rule is that
   a number is never reused *even if soft-deleted*. A `Pending` row on `Detours`
   would burn a permanent number on a candidate that may be rejected as a
   duplicate. Numbers should be allocated **at promotion**, not at intake.
2. **Computed status.** As above — a dateless pending row reads as `active`.
3. **Every read path would need a new filter.** `detoursList.ts` has no lifecycle
   concept; `DetourReports.tsx` searches everything it returns. Unreviewed noise
   would leak into the compliance-facing reporting page on day one.

**The one real cost, which the draft misses:** `DetourImages.detour_id` is a
`NOT NULL` FK to `Detours(id)`. Intake attachments therefore need either a
nullable polymorphic parent (`detour_id` OR `intake_id`, with a CHECK that
exactly one is set) or a copy-forward at promotion. Recommend the polymorphic
parent — copy-forward means duplicating blobs and breaking the purge timer's
`end_date`-based cleanup.

---

### Finding 3 — Map tool (B13): more infrastructure exists than the draft assumes, and one hard gap

**Already in place — do not re-solve:**
- `azure-maps-control@^3.7.4` is already a dependency of `onboard-console`.
- `GET /maps/token` (`mapsToken.ts`) already mints short-lived Azure Maps tokens
  via managed identity — zero standing secret.
- `EventMonitoring.tsx` is a working reference implementation (map init,
  `AuthenticationType.anonymous` + token callback, markers, popups, style switcher).
- `GtfsStops` (migration-005: `stop_id`, `stop_name`, `stop_lat`, `stop_lon`) is
  populated daily by `gtfsStopsSync.ts` from `GTFS_STATIC_URL`.

**Draft's open question #4 (GTFS vs Spare Labs) is answered by the repo:** GTFS
static is what's in the database, it's what Avail publishes from, and Spare Labs
covers on-demand zones rather than fixed-route stops. Use `GtfsStops`.

**Gaps the draft doesn't name:**
- `mapsToken.ts` gates on `[...STAFF_READ_ROLES, "OCC.Compliance"]` — it does
  **not** include `OCC.Detour`. A detour-role user opening the map tool gets a
  403. One-line fix, but it must be explicitly in scope.
- There is **no stops API endpoint**. Needs `GET /gtfs/stops`.
- There is **no structured stop linkage on detours at all.** B1 deliberately
  punted this (`riders_directed` free text) and the consolidated plan said to
  revisit "only if a future map view needs queryable stop data." **That trigger
  has now fired.** B13 requires a real `DetourStops`/`DetourIntakeStops` table —
  this is a schema addition the draft does not mention.

**v1 scope recommendation: draw-and-snap, not routing.** Draw a polyline, apply a
buffer radius, return candidate stops, and have the intake person confirm/reject
each one with a side-of-street (left/right) field per stop. Routing is the wrong
call for v1: there is no routing data in the database, Azure Maps routing is a
separate metered service, and turn-by-turn is already handled — staff type it
into `DetourSegments.directions` today and the reviewed notices show that's the
format recipients expect.

---

### Finding 4 — Conflict rules (B14) are dependent on B13, and the feed-side check has a hidden prerequisite

The draft presents B14 as its own workstream with two trigger points. Two
corrections:

1. **There is nothing to conflict-check against today.** No detour in the system
   carries stop-level data. B14 is strictly downstream of B13's stop linkage —
   it cannot be built or even meaningfully specified first.
2. **The feed-ingestion trigger has an unbuilt prerequisite.**
   `availDetoursSync.ts` consumes only the `Detours` feed; B4 explicitly declined
   to consume Avail's sibling `DetourStops` feed, and the consolidated plan
   records that envelope as **the one Avail envelope still genuinely unverified**.
   So Avail-sourced detours have no stops either, and a feed-side conflict check
   is impossible until that feed is consumed and its envelope confirmed against
   live data.

**Recommendation:** v1 conflict check runs on the **manual path only**
(control-center apply-time). The feed-side check moves behind a scoping spike on
the Avail `DetourStops` envelope, and B16's "both paths get the same check"
guarantee should be stated as a phase-2 goal rather than a v1 property.

**Hard block vs warn+override:** warn + override, matching the draft's own
recommendation and the repo's convention throughout (`last_edited_manually`
preserves the human correction; nothing in this codebase auto-decides). Log the
override to a row with a reason, not a boolean — the three legacy notification
booleans are exactly the "yes/no with no context" shape B9 was written to
replace.

---

### Finding 5 — B14a is a good catch, but its dissemination gate is blocked

B14a's failure mode (manual record approved, Avail build fails, record floats as
"applied" while nothing exists in Avail) is real and worth the column. Given the
`lifecycle_state` column from Finding 1, it's cheap.

**But B14a's stated payoff — "should NOT go out for dissemination until
resolved" — has nothing to gate.** There is no dissemination. B8 and B9 are not
built. Same for B15's contractor email, which the draft describes as "additive to
B9's internal distribution."

**This is the single biggest sequencing error in the draft:** B14a's gate and
B15's email both depend on B8/B9, which are unbuilt *and* still carry an
unresolved decision (Graph shared mailbox vs. existing SMTP relay vs. SendGrid).
Either B8/B9 move into this expansion's scope, or B14a ships as a status field
whose enforcement point arrives later.

**Manual confirmation is the right v1** (draft's own instinct). Round-trip
confirmation via GTFS ingestion would need the detour matched back from the feed,
which is exactly the `external_detour_id` linkage that only exists for
`source='avail'` rows — a manual row has none until someone types it in.

**Stale-record nudge:** reuse the existing pattern rather than inventing one.
`AppSettings` (migration-032) holds admin-editable thresholds; `AppPollState`
provides the database-backed lease so only one scaled instance fires a due poll.
Both were built generically for exactly this.

---

### Finding 6 — Roles: the answer already exists

Draft's open question #2 asks whether intake needs a new role or uses OCC User
Admin. Neither — **`OCC.Detour` already exists** (`auth.ts:87–103`,
`DETOUR_READ_ROLES` / `DETOUR_WRITE_ROLES`), and the consolidated plan doesn't
mention it. Use it.

Adding a new role would also worsen an outstanding problem the consolidated plan
already flags as open item 12: nav roles in `App.tsx`, read roles in
`detoursList.ts`, write roles, and attachment roles don't currently agree for
`OCC.Compliance`. Resolve that inconsistency during this work rather than adding
a fourth role to keep in sync.

Proposed gating: intake create/edit → `DETOUR_WRITE_ROLES`; control-center
approve/reject → `DETOUR_WRITE_ROLES`; everything read → `DETOUR_READ_ROLES`;
templates admin → `ADMIN_ROLES`.

---

### Finding 7 — B16 public display: the page is cheap, the attachment preview is the risk

**Option A is genuinely available and small.** `frontend/packages/rider-app`
already exists (`ServiceAlerts.tsx`, `OptIn.tsx`) and consumes
`GET /messages/active`, which is `authLevel: "anonymous"` with no `requireRole`
call at all — a proven public-read pattern with a real consumer. A public detour
list is a new anonymous endpoint plus a route in an app that already ships.

**The attachment-preview requirement is the problem.** The draft asks for inline
preview of any attachment sent with a detour. That collides directly with three
things:

1. **B11 isn't built.** There is no `DetourAttachments` table and no PDF preview,
   internal or otherwise.
2. **B3's storage account has never been provisioned.** No attachment of any kind
   has ever been stored or served. This owner action has been outstanding since
   before the draft was written and blocks every attachment path.
3. **The access model is fundamentally private.** Attachments live in a private
   container served by short-lived SAS URLs minted per *authenticated* request.
   Handing SAS read URLs to an anonymous endpoint is functionally making the
   container public. B11 deferred exactly this and left three questions open:
   Active-only vs Active+Upcoming visibility, public-read mirror container vs.
   another serving mechanism, and per-attachment `is_public` opt-in given the
   bystander-privacy/licensing concern B3 raised about staff phone photos.

**Recommendation: split B16.**
- **B16a** — public detour list + detail (closure, dates, routes, turn-by-turn,
  riders-directed text). Buildable now, no blockers.
- **B16b** — attachment preview. Blocked on the storage deploy, on B11, and on
  the `is_public` decision. Do not build partial scaffolding toward it.

On the draft's "is this duplicating Avail/GTFS?" question: it isn't, and the
draft's own B16 resolution is the right read. Avail publishes only what could be
*built* in Avail. The whole reason this module exists is that many closures can't
be built there and go out as operator text instead — those are invisible to
riders today. A unified page is the only surface that shows both.

---

### Finding 8 — B17 is nearly free, and the draft is right about sharing the mechanism

Clone already exists, and it is **pure frontend**: `detourToCloneForm()`
(`Detours.tsx:173`) and `openCloneForm()` (`:270`) build a form state and let the
normal `POST /detours` allocate a fresh number. There is no backend clone
endpoint to share — so "one shared clone/re-establish function" means one shared
*frontend* function with a second trigger on expired rows. Near-zero cost.

Note that clone deliberately drops the notification flags and approval fields.
Templates must do the same, and must not carry `lifecycle_state` either.

Templates are the genuinely new piece and need a table
(`DetourTemplates` + `DetourTemplateSegments`, mirroring `Detours`/`DetourSegments`).

---

### Finding 9 — smaller items

- **B15 spreadsheet migration** has no technical blockers — it's data entry
  against a shipped schema. One caveat: importing N rows through `POST /detours`
  allocates N sequential internal numbers in insertion order, so import in
  chronological order or the numbering will be nonsensical and unfixable
  (numbers are never reassigned).
- **`backfill-detour-numbers-gap.sql` is still pending** per the consolidated
  plan — run it after the B10 code deploy, before any bulk import.
- **Payload growth.** `detoursList.ts` returns every non-deleted detour and both
  `Detours.tsx` and `DetourReports.tsx` filter client-side. B7 already flagged
  this as an assumption. Adding stop arrays and lifecycle data to every row makes
  it worse — plan for server-side filtering at the same time, or at minimum
  don't include stop arrays in the list response (fetch per-detour on detail open).

---

## Part 2 — Implementation plan

Renumbered as the draft invited. `B18` is new — the lifecycle-state foundation
Finding 1 requires.

### Decisions needed before Phase 1 (owner)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| 1 | Two-axis status model (stored `lifecycle_state` + computed date `status`), never merged | B18, everything after | Accept — the alternative breaks a shipped, deliberately-designed invariant |
| 2 | Separate `DetourIntake` table, number allocated at promotion | B12 | Accept — three concrete code reasons in Finding 2 |
| 3 | Map v1 = draw + buffer + confirm, not routing | B13 | Accept |
| 4 | Stop source of truth = `GtfsStops` | B13 | Settled by the repo |
| 5 | Conflict = warn + override with logged reason; manual path only in v1 | B14 | Accept |
| 6 | Avail build confirmation is manual in v1 | B14a | Accept |
| 7 | **Are B8/B9 in scope for this expansion?** | B14a gate, B15 email | Must answer — see Finding 5 |
| 8 | Email send mechanism: Graph shared mailbox vs. existing SMTP relay vs. SendGrid | B9, B15 | Still unresolved from the consolidated plan |
| 9 | B16 split: public list now, attachment preview deferred | B16 | Accept |
| 10 | Per-attachment `is_public` opt-in, defaulting off | B16b | Needed before any public attachment work |
| 11 | Reuse `OCC.Detour`, no new role | all | Accept |
| 12 | **Approve and deploy `storage-detour-images.bicep`** | B11, B16b | Outstanding since before this draft |

### Phase sequence

**Phase 0 — Unblock and reconcile** *(no new features)*
- Deploy `storage-detour-images.bicep`; set `DETOUR_IMAGES_STORAGE_ACCOUNT`;
  prove B3 executes for the first time.
- Run `backfill-detour-numbers-gap.sql` after the B10 code deploy.
- Fix the role inconsistency (consolidated-plan open item 12) across nav, list,
  edit, and attachment surfaces so all four agree.
- Add `OCC.Detour` to `mapsToken.ts`'s role list.
- Confirm current migration head (expected 033).

**Phase 1 — B18: lifecycle state foundation**
- Migration: `Detours.lifecycle_state NVARCHAR(30) NULL` + CHECK constraint,
  backfilled to `built_in_avail` for existing rows (they're all real detours).
- Extend `detourStatus.ts` with a `isLive(detour)` helper combining both axes —
  one definition, same discipline as the existing computed status.
- Surface read-only in `Detours.tsx` detail panel and as a `DetourReports.tsx`
  filter.
- *No behavior change yet* — this phase only makes the axis exist.

**Phase 2 — B12: intake stage**
- Migration: `DetourIntake` (+ source-of-detection, description, location,
  proposed window, `lifecycle_state`, audit fields); polymorphic parent on the
  attachments table.
- API: `GET/POST/PATCH /detour-intake`, plus `POST /detour-intake/{id}/promote`
  (allocates the internal number, creates the `Detours` row, re-parents
  attachments, all in one transaction).
- Frontend: intake queue view + form. New nav entry in the existing "Tools" group.

**Phase 3 — B13: stop linkage + map tool**
- Migration: `DetourStops` / `DetourIntakeStops` (`stop_id`, side-of-street,
  `is_confirmed`).
- API: `GET /gtfs/stops` (with bbox filter).
- Frontend: map component modeled on `EventMonitoring.tsx` — draw polyline,
  buffer radius, candidate stops surfaced for confirm/reject, side-of-street per
  stop.
- Backfill path: existing detours have no stops; leave them null rather than
  guessing from `riders_directed`.

**Phase 4 — B14 / B14a: conflict rules + Avail build state**
- Conflict check on promote and on detour update, over `DetourStops`, scoped to
  overlapping date windows. Warn + override with a logged reason row.
- `build_failed` handling and retry path in the console.
- Stale-record nudge: `AppSettings` threshold + timer poller using `AppPollState`
  for the lease.
- *Feed-side conflict check deferred* pending the Avail `DetourStops` envelope spike.

**Phase 5 — B17: templates + re-establish** *(parallelizable with 3–4)*
- Migration: `DetourTemplates` / `DetourTemplateSegments`.
- API: template CRUD (`ADMIN_ROLES`).
- Frontend: extend the existing `detourToCloneForm()` into one shared
  prefill function with three triggers — clone, re-establish from expired, apply
  template. Must drop notification flags, approval fields, and `lifecycle_state`
  in all three cases.

**Phase 6 — B8/B9: distribution lists + notify/send** *(only if decision 7 says in scope)*
- Exactly as specified in the consolidated plan. Blocked on decision 8.

**Phase 7 — B15: spreadsheet migration + contractor email**
- Import in chronological order (see Finding 9).
- Contractor email = a second `DetourNotificationGroup`, not new machinery —
  assumes Phase 6 shipped.

**Phase 8 — B16a: public detour page**
- New anonymous endpoint (`GET /detours/public`) returning only rows where
  `isLive()` or recently expired, and only public-safe fields — *not* the full
  row shape the console gets.
- Route in `rider-app`, following the `ServiceAlerts.tsx` pattern.

**Phase 9 — B16b: public attachment preview** *(blocked)*
- Requires Phase 0's storage deploy, B11's `DetourAttachments` generalization,
  and decision 10's `is_public` opt-in. Do not scaffold toward this earlier.

### Per-phase checklist
- `npm run build && npm test` in `functions-restapi`; pure-function tests for the
  conflict-detection and stop-buffer logic (both testable independent of the DB).
- `npm run build` in `frontend`.
- Bump `frontend/packages/onboard-console/package.json` version.
- Update `CHANGELOG.md` and `HANDOFF.md`.
- Migration run against dev, head re-confirmed first.

---

## Answers to the draft's nine open questions

1. **Intake table vs `Pending` status** → separate `DetourIntake` table (Finding 2).
2. **Who performs intake** → existing `OCC.Detour` role (Finding 6).
3. **Map v1 scope** → draw + buffer + human confirm, not routing (Finding 3).
4. **Stop source of truth** → `GtfsStops`, GTFS static (Finding 3).
5. **Hard block or warn+override** → warn + override, reason logged to a row (Finding 4).
6. **Avail build confirmation** → manual in v1; round-trip needs linkage that
   manual rows don't have (Finding 5).
7. **B16 public or internal** → both, split into B16a (buildable now) and B16b
   (blocked). Not duplicating Avail — Avail only publishes what could be built in
   Avail, and the unbuildable ones are the reason this module exists (Finding 7).
8. **Shared clone mechanism** → yes, and it's frontend-only; cheaper than the
   draft assumes (Finding 8).
9. **Owned handoff vs stale nudge** → both, as the draft recommends; the nudge
   reuses `AppSettings` + `AppPollState` (Finding 5).
