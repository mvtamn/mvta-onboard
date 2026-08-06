# MVTA OnBoard — Detour & Closure module: build brief

Context for whoever (Claude Code) implements this: MVTA currently tracks detours and
closures by hand across three places — Avail (when the detour can actually be built
there), an email to staff/operators, and an Excel tracker. Many closures are never built
as real Avail detours because Avail won't allow two detours to touch the same stop or
segment, so those go out as plain operator text messages and rider alerts instead, which
is why nothing lives in one place today.

A working prototype of the target UI (single entry form, auto-computed status tabs,
one-click email generation) was built as a throwaway HTML artifact and validated against
the real tracker data. This brief is the spec to build the real thing as a module in
`mvta-onboard`, not the artifact code itself.

## Data model needed

**Detours** (one row per closure/detour, whether or not it's built in Avail)
- `Id`, `Number` (free text — "951", "Operator Message", "993 & 994" all appear in current use), `Closure` (location/description), `StartDate`, `EndDate` (nullable — many are open-ended), `IsMonitorOnly` (bool — "watching a location, no confirmed closure yet"), `RidersDirected` (free text, used for stop closures), `EmailSent`, `ExpiredEmailSent`, `SpareEmailed` (the three tracker flags), audit fields (`CreatedBy/At`, `UpdatedBy/At`), soft-delete flag.
- Add `Source` (`manual` | `avail`) and `ExternalDetourId` — see sync section below. Without these two columns, an Avail sync will create duplicate rows every time it runs instead of updating existing ones.

**DetourSegments** (one row per route/direction variation under a Detour)
- `DetourId`, `Routes` (e.g. "460 SB, 465 SB"), `Directions` (the turn-by-turn text), `SortOrder`.

Status (Active / Upcoming / Monitor / Recently finished / Expired) should be **computed from dates**, not stored — it needs to be identical whether it's driving the OnBoard UI tabs or any future "active detours only" query, so it belongs in one shared function both the API and the UI import, not duplicated.

## Image attachments

Ask was: staff should be able to attach images to a detour (photos of signage, a hand-marked map, a screenshot) and see them surfaced when reviewing the detour's detail.

**Data model addition — `DetourImages`**
- `Id`, `DetourId`, `BlobPath` (not a public URL — see access model below), `FileName`,
  `ContentType`, `SizeBytes`, `Caption` (optional, free text), `SortOrder`, `UploadedBy`,
  `UploadedAt`.

**Storage**: Azure Blob Storage is the natural fit given the rest of the stack (this isn't
in the current OnBoard component list, so it's a new resource to provision — flag it in
the PR/deployment notes). Recommended upload flow, to avoid ever putting a storage account
key in the browser:
1. Client asks a Function endpoint (`POST /api/detours/{id}/images/upload-url`) for a
   short-lived SAS write token scoped to one blob.
2. Client uploads the file directly to Blob Storage using that token.
3. Client then calls `POST /api/detours/{id}/images` with the blob path + filename/caption
   to create the `DetourImages` row.
4. Reads happen the same way in reverse — the API hands back short-lived SAS read tokens
   rather than serving images itself or making the container public-read.

Default to a **private container with short-lived SAS reads** rather than public-read,
since this hasn't been discussed with IT — it's a safer starting point that can be relaxed
later if load time or caching becomes a real problem. Worth deciding with Ty rather than
defaulting silently either way.

**Review mode**: images should surface in the same detail view that already shows
per-route directions (the expand panel in the prototype) — a thumbnail row, click through
to full size. In the entry form, add a multi-file upload control with thumbnail preview
and the ability to remove/reorder before saving.

**Things to confirm before Claude Code builds this**, rather than assuming:
- Who can upload — same role tier as who can create/edit detours, or should read-only
  User Admin/OCC staff also be able to attach a photo without full edit rights?
- Expected file types and rough size (phone photos will commonly be several MB each —
  worth deciding if client-side resize/compression happens before upload to control
  storage cost and load time).
- Retention: photos of a road closure taken from a phone can incidentally include license
  plates or bystanders. Worth deciding whether images get purged when a detour expires (or
  after some retention window) rather than accumulating indefinitely, particularly for a
  public-facing transit agency.

## Avail data feed review

Two Avail OpenAPI specs were provided: `Detours/v1/{Property}` and
`DetourStops/v1/{Property}`. Both hit `avail360-test.myavail.cloud` (test environment)
and require an `Ocp-Apim-Subscription-Key` header or query param.

### Feed 1 — Detours (`GET /Detours/v1/{Property}`)

This is the useful one. Per row it returns:

| Field | What it is | Maps to |
|---|---|---|
| `DetourID` | Avail's internal detour number | `Detours.ExternalDetourId` — use as the upsert key |
| `DetourName` | Short label | `Detours.Number` or `Closure`, whichever reads better once you see real data |
| `RouteID`, `Direction` | e.g. Route 100, Inbound | `DetourSegments.Routes` |
| `TurnByTurnMessage` | Full turn-by-turn text | `DetourSegments.Directions` |
| `StartDate`, `EndDate` | Date range | `Detours.StartDate/EndDate` |
| `IsActive` | Avail's own active flag | informational only — don't use it in place of the computed status logic, since Avail's "active" doesn't know about your monitor/recent/expired distinctions |
| `Cause`, `Effect` | e.g. "Construction" / "Detour" | worth keeping as extra columns for filtering later, not required for MVP |
| `CreatedBy/On`, `UpdatedBy/On` | Avail's audit trail | useful for the audit log, but tag it clearly as Avail-sourced, don't merge with your own `CreatedBy` |

One thing to watch: a single detour comes back as **multiple rows sharing one
`DetourID`** — one row per direction (the sample shows Inbound and Outbound as separate
rows with the same `DetourID: 30`). Group by `DetourID` on ingest and turn each row into
a `DetourSegments` entry, which maps cleanly onto the segments concept already in the
data model.

Also worth flagging: `TurnByTurnMessage` in the sample reads like geocoded turn-by-turn
("Turn right onto 49th St N") rather than the operator shorthand MVTA actually uses
("Reg Kellogg: R Minnesota St: BTR:"). Treat it as a starting draft that a person reviews
and edits before an email goes out, not something to pipe straight into rider
communications unedited.

### Feed 2 — Detour Stops (`GET /DetourStops/v1/{Property}`)

Returns stops tied to a `DetourId`: `StopID`, `Report_Label`, `Description`,
`Internet_Name`, `Latitude`, `Longitude`.

This is thinner than it first looks. It's a list of stops *geographically associated*
with the detour — there's nothing in the schema distinguishing a **missed** stop from a
**replacement** stop, or capturing "riders directed to X." That distinction is exactly
what fills the `RidersDirected` field in the tracker today, and this feed doesn't carry
it. It's useful later for plotting the detour and its stops on a map, but it does not
remove the need for manual `RidersDirected` entry.

### Recommendation

- **Use the Detours feed as a one-way sync source.** It can auto-populate Number, dates,
  routes, and a first-draft of the directions text for any closure that's actually built
  as a formal Avail detour — which, by your own description, is a minority of what you
  track, but it's real duplicate-entry elimination for that subset.
- **Don't build on the Detour Stops feed for the current problem.** It doesn't carry the
  "riders directed to" semantics that are the actual pain point for stop closures. Revisit
  it only if/when a map view of detours becomes a priority.
- **Everything that's never built in Avail — operator messages, stop closures, anything
  blocked by Avail's overlap limitation — still needs manual entry through the OnBoard UI.**
  No feed change fixes that; it's a limitation of Avail's detour engine, not a data access
  problem.

### Sync architecture

- Timer-triggered Azure Function polling `Detours/v1/{Property}` on a schedule (start with
  every 15–30 min, adjust once you see how often Avail data actually changes).
- Upsert on `ExternalDetourId` (Avail's `DetourID`): if a row with that external ID exists,
  update it and its segments; if not, insert a new `Detours` row with `Source = 'avail'`.
- Never let the sync touch a row with `Source = 'manual'` — those are the operator
  message / stop closure entries that will never appear in Avail's feed, and a naive sync
  that clears "missing" rows would delete them.
- If a synced (`Source = 'avail'`) row is hand-edited in OnBoard afterward, decide up
  front whether the next sync should overwrite the edit or skip rows that have been
  manually touched (a `LastEditedManually` flag is the simplest way to do this) — worth
  deciding with Ty before writing the merge logic, not after.

### Open questions to confirm before building the sync (not blocking the manual-entry UI)

1. ~~Production base URL~~ — **confirmed**: `https://avail360-api.myavail.cloud/` (the
   OpenAPI spec's `avail360-test.myavail.cloud` is the test/sandbox host only — point the
   sync function at the `-api` host, not `-test`, for real data). Full production
   endpoints: `https://avail360-api.myavail.cloud/Detours/v1/{Property}` and
   `https://avail360-api.myavail.cloud/DetoursStops/v1/{Property}`.
2. Where the `Ocp-Apim-Subscription-Key` will live (Key Vault secret name) and who owns
   requesting/rotating it.
3. ~~MVTA's actual `Property` code~~ — **confirmed**: `MVTA`. Full production endpoints
   are therefore `https://avail360-api.myavail.cloud/Detours/v1/MVTA` and
   `https://avail360-api.myavail.cloud/DetoursStops/v1/MVTA`.
4. Confirm the nested `"detours"` array key name in the Detour Stops response isn't a
   copy-paste artifact from the Detours spec (both specs use the same key name inside
   `result`, which is worth double-checking against a live response rather than assuming
   the doc is accurate).
5. Expected polling cadence / rate limits Avail is comfortable with.
6. ~~Confirm whether the production key requires a different subscription/API key than
   the test environment~~ — **confirmed by the owner: no, production does not need its
   own subscription key.** The Detours sync reuses the same production key already in
   use for AVL Reports/Pullout/OTP Monthly/Missed Trips
   (`AVAIL_AVL_REPORTS_API_KEY`).
   hand may not work against `-api`.

## Suggested build order

1. Schema migration for `Detours` / `DetourSegments` (include `Source` and
   `ExternalDetourId` from the start, even before the sync exists, so it isn't a
   migration-after-the-fact).
2. Manual-entry CRUD API + staff console UI — this alone reproduces the working artifact
   and solves the "three places" problem for anything not built in Avail.
3. Image attachments (`DetourImages` table, Blob Storage container, SAS upload/read
   endpoints, thumbnail UI in both the entry form and the review/detail panel) — can land
   right after step 2 since it doesn't depend on the Avail sync.
4. Avail sync function, once the open questions above are answered.
5. Decide and build the manual-edit-vs-sync-overwrite behavior described above.
