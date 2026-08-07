# Implementation Plan — Detour & Closure Module (Consolidated)

**This document supersedes and consolidates:**
- `detour-module-build-brief.md` (original spec)
- `detour-module-implementation-plan.md` (B1–B5 implementation plan)
- `detour-and-event-module-implementation-plan.md` (Part B only — Part A, Route
  Classification / Event bus monitoring, is a separate live workstream and is
  NOT superseded). Note that every code comment in the shipped detour files
  cites this filename, so it stays the name of record inside the source until
  those comments are updated.
- `detour-reporting-and-search-spec.md` (draft reporting fields + search page)

All prior detour-related instructions to Claude Code should be read through this single file going forward.

## Status at a glance

| Part | What it is | Status |
|---|---|---|
| B1 | `Detours`/`DetourSegments` schema | **Shipped** (migration-017) |
| B2 | Manual CRUD API + console module | **Shipped** |
| B3 | Image attachments (Blob Storage) | Code **shipped**, but **NOT functional** — the Blob Storage account has never been provisioned |
| B4 | Avail Detours sync | **Shipped** (committed `aa04b9d`); `AVAIL_DETOURS_URL` set 2026-08-06 — confirm it returns non-zero detours against live data |
| B5 | Sync-overwrite behavior | **Shipped** (migration-019, run against dev) |
| B6 | Reporting fields (reason code, severity, approvals, notification-channel flags) | **Draft — pending approval**, not built |
| B7 | Active/Expired reporting page + search | **Draft — pending approval**, not built |
| B8 | Notification distribution lists | **New, this pass — pending approval**, not built |
| B9 | Notification drafting + send (email/Teams) | **New, this pass — pending approval**, not built |
| B10 | Internal detour numbering (`MVTA-DET-YYYY-####`) | **Built**, migration-024 **run against dev** 2026-08-06 — code not yet deployed, so run `backfill-detour-numbers-gap.sql` after deploying |
| B11 | Document attachments (generalized beyond images) + console preview | **New, this pass — pending approval**, not built |

Per the standing instruction carried over from the reporting spec: **nothing in B6 onward ships until explicitly approved, section by section or all at once.** B1–B5 are built and are not to be reworked by this document — they're included below only as context for what B6+ builds on top of.

**Two corrections to how "shipped" reads above, both verified against the repo:**
- **B1/B2/B5's migrations were run against the DEV database.** Production status is not recorded anywhere in `HANDOFF.md` and should not be assumed — confirm before describing any of this as live in prod.
- **B3 is shipped code that has never once executed.** `storage-detour-images.bicep` was never deployed, so there is no storage account, and every image endpoint returns its 503 "not configured" path. That the code was unexercised is not theoretical: a guaranteed-403 bug (the SAS token always outlived the user-delegation key that signed it) and a missing-CORS bug both sat undetected in it until 2026-08-06. Treat B3 as *awaiting first real execution*, not as proven.

## Context

MVTA currently tracks detours/closures across Avail (when buildable there — Avail won't allow two detours to touch the same stop/segment, so many go out as plain operator/rider text messages instead), a manual email to staff/operators, and an Excel tracker. `Detours`/`DetourSegments` (B1–B3) already replaced the three-places entry problem for day-to-day intake. What's still manual: syncing the subset that *is* built in Avail (B4/B5), matching MVTA's actual internal ops-reporting fields (B6/B7), and — new focus of this pass — actually **sending** the notification email/Teams post that today gets hand-typed from scratch every time.

**Real examples reviewed for this pass** (four internal MVTA detour-notice emails, Aug 2026): a UofM Washington Ave closure forcing reroutes on 465B/475X/465/475/490P/490M with two named replacement-stop assignments; a Food Truck Festival closure of Central Pkwy forcing a 445 detour in both directions *while a separate event shuttle runs the same corridor* (the closest real-world overlap point with the Event Bus Monitoring workstream); and a ramp-closure notice bundling two separately-dated closures (Cliff Rd ramp, Diffley Rd ramp) in one email. Findings baked into B6–B9 below:
- `DetourSegments` (route-group + turn-by-turn text) already matches these emails' structure exactly — one row per route/direction block, no schema change needed.
- `riders_directed` free text already comfortably captures "riders directed to temp stop (Stop ID 41705)" phrasing — no structured stop-reference column needed yet. Revisit only if a future map view needs queryable stop data (same call the original brief made about the `DetourStops` feed).
- A single notice commonly bundles two or more separately-dated sub-closures — that's naturally two `Detours` rows, not one row with multiple date ranges. Worth a "clone this detour" affordance in the entry form so shared context (closure area, routes) doesn't need re-typing (see B6 UX note).
- Every real notice has a Cc distribution list and a signed footer — this is what B8/B9 replace.

---

## B1. Schema — shipped

`Detours`/`DetourSegments` (migration-017): `id`, `number`, `closure`, `start_date`/`end_date`, `is_monitor_only`, `riders_directed`, `email_sent`/`expired_email_sent`/`spare_emailed`, `source` (`manual`|`avail`), `external_detour_id`, `last_edited_manually`, `is_deleted`, audit fields. `DetourSegments`: `detour_id`, `routes`, `directions`, `sort_order`. Status (Active/Upcoming/Monitor/Recently finished/Expired) computed by `functions-restapi/src/lib/detourStatus.ts`, never stored.

## B2. Manual CRUD + console module — shipped

`POST/GET/PATCH/DELETE /detours`, `Detours.tsx` top-level route, `DETOUR_ROLES = ["OCC.Viewer","OCC.Publisher","OCC.Admin","OCC.Compliance"]`, soft-delete only.

## B3. Image attachments — code shipped, never executed

`DetourImages` table, Blob Storage (SAS upload/read, managed-identity-signed, private container), client-side resize, purge timer at `end_date` + 30-day grace window (note: open-ended detours with a null `end_date` never purge — accepted tradeoff, verified as the actual behavior of `detourImagesPurge.ts`'s `d.end_date IS NOT NULL` filter, revisit if it becomes a real cleanup problem).

**Blocking gap:** `infra-phase1/modules/storage-detour-images.bicep` has never been deployed, so none of this works yet. Deploy the *module alone*, not `main-phase1.bicep` (a full-stack deploy also re-runs the Function App and WAF, and Front Door was hand-built in the portal). Requires Owner or User Access Administrator on the resource group for the role assignment; the dev account name resolves to `stmvtadetourimgdevmvtajx`; `DETOUR_IMAGES_STORAGE_ACCOUNT` must then be set on `func-mvta-restapi-dev`. See `HANDOFF.md` for the full runbook. **B11 cannot be verified until this is done.**

---

## B4. Avail Detours sync — shipped

- `functions-restapi/src/lib/availDetoursFeed.ts` — `fetchDetours(baseUrl, apiKey)` against `https://avail360-api.myavail.cloud/Detours/v1/MVTA` (confirmed production host/property). Groups multiple rows sharing one `DetourID` (one per direction) into one `Detours` row + N `DetourSegments` rows.
- **Envelope key CONFIRMED live 2026-08-05 — do not re-litigate this.** The original guess of `result.Detours` (capital D) was wrong; the real key is lowercase `result.detours`, with `results` as a sibling metadata array (`RefreshTime`/`Property`). The fallback diagnostic that caught it is still in place and now names the correct key in its error text. The only Avail detour envelope still genuinely unverified is the sibling `DetourStops` feed, which this module deliberately does not consume.
- `functions-restapi/src/functions/availDetoursSync.ts` — timer (`"0 */15 * * * *"`, 15 min starting cadence), upserts by `external_detour_id`, **never touches a `source = 'manual'` row**.
- `DetourStops` feed explicitly not built on — doesn't carry "riders directed to" semantics, the actual pain point.
- App setting `AVAIL_DETOURS_URL`; reuses existing `AVAIL_AVL_REPORTS_API_KEY` (confirmed — no separate production key needed). **Verify `AVAIL_DETOURS_URL` is actually set on `func-mvta-restapi-dev`** before treating the sync as running; `HANDOFF.md` previously recorded it as unset and that record was stale in other respects.
- **Open questions (from the original brief, still unresolved):** where the `Ocp-Apim-Subscription-Key` lives (Key Vault secret name, who owns rotation), and confirmed polling cadence/rate limits Avail is comfortable with.

## B5. Sync-overwrite behavior — shipped

`last_edited_manually` (B1 schema) plus `avail_last_seen_at` (added by `migration-019-detour-avail-last-seen.sql`, already run against the dev DB) resolve the conflict: when the sync finds an existing `source='avail'` row with `last_edited_manually = 1`, it skips overwriting editable fields but still updates the last-seen timestamp. Safer default (preserves a human correction); still flagged as the assumption being made, easy to flip to always-overwrite once real sync behavior is observed against live data.

---

## B6. Reporting fields (draft — pending approval)

**Caveat carried over unchanged from the original spec:** there's no document describing MVTA's actual internal detour-reporting form. Every field below is a draft built from standard transit-ops reporting practice layered onto the existing Excel tracker's fields — **treat as a proposal to correct against the real form, not a confirmed requirement.**

### New table: `DetourReasonCodes`

Mirrors `OtpReasonCodes` (migration-018) exactly:
```sql
CREATE TABLE DetourReasonCodes (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code        NVARCHAR(30)  NOT NULL,
    label       NVARCHAR(100) NOT NULL,
    is_active   BIT           NOT NULL DEFAULT 1,
    sort_order  INT           NOT NULL DEFAULT 0,
    updated_by  NVARCHAR(200) NULL,
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UX_DetourReasonCodes_Code UNIQUE (code)
);
```
Draft seed values (**confirm against MVTA's real categories**): `construction`, `accident_crash`, `weather`, `special_event`, `utility_work`, `city_county_project`, `parade_race`, `other`. The reviewed emails suggest at least `special_event` (Food Truck Festival) and `city_county_project`/`construction` (UofM/ramp closures) are real, active categories.

### New columns on `Detours`

| Column | Type | Purpose |
|---|---|---|
| `reason_code` | `NVARCHAR(30) NULL` | Soft reference to `DetourReasonCodes.code` (non-FK, same convention as `OtpStopExclusions.reason_code`). |
| `severity` | `NVARCHAR(10) NULL`, `CHECK IN ('minor','moderate','major')` | Draft 3-tier scale — confirm whether MVTA uses a different scale or none. |
| `reported_by` / `reported_at` | `NVARCHAR(200) NULL` / `DATETIME2 NULL` | Who/when first reported, if it can lag `created_by`/`created_at`. May be redundant — confirm before building. |
| `approved_by` / `approved_at` | `NVARCHAR(200) NULL` / `DATETIME2 NULL` | Only add if a real sign-off step exists distinct from an `OCC.Publisher` posting it. |
| `radio_notified` | `BIT NOT NULL DEFAULT 0` | Extends the existing three-boolean notification convention with one flag per channel. |
| `dispatch_board_notified` | `BIT NOT NULL DEFAULT 0` | Same pattern. |
| `social_media_notified` | `BIT NOT NULL DEFAULT 0` | Same pattern. |
| `resolution_notes` | `NVARCHAR(1000) NULL` | Free-text, filled in around Expired. |

**Open question, not a build blocker:** does the existing `number` field already serve as MVTA's internal reference number? Default assumption is yes — no new column added for it.

**UX note (new this pass, from the reviewed emails):** the entry form gains a **"Clone as new detour"** action on an existing detour's detail panel — copies `closure`/`reason_code`/segments as a starting point into a new draft with blank dates, for the bundled-multi-closure-different-dates case (Image 4's two ramp closures in one notice).

### Backend / Frontend

Same as originally spec'd: `detourReasonCodes.ts` (new, mirrors `otpReasonCodes.ts`), `detoursCreate.ts`/`detoursUpdate.ts`/`detoursList.ts` extended, `validation.ts` gets `validateDetourReport`. No new audit-log table — the row's own timestamp columns are the audit trail (same pattern as `AuditLog.tsx`/OTP's `otpAuditStream.ts`). `Detours.tsx` form gains the new fields + Clone action; detail panel surfaces them read-only.

## B7. Active/Expired reporting page, searchable (draft — pending approval)

New, separate, read-only page — **"Detour Reports"** — for compliance/ops leadership to search/reference detour history without edit controls. `Detours.tsx` stays the day-to-day entry/edit workspace; one small addition lands there regardless of B7's approval: a plain text search box over the table already on screen.

- Nav: `STAFF_READ_ROLES` + `"OCC.Compliance"`, no write actions.
- **Pre-existing bug to fix first, not introduce.** `auth.ts`'s `STAFF_READ_ROLES` is `["OCC.Viewer","OCC.Publisher","OCC.Admin"]` — it does **not** include `OCC.Compliance`. But `App.tsx`'s shipped `DETOURS` nav constant *does*, so a Compliance user can already navigate to `/detours` today and receive a 403 from `GET /detours` (gated on `STAFF_READ_ROLES` in `detoursList.ts`). B7 reads the same endpoint, so it inherits the identical failure. Fix `detoursList.ts` (and B7's own read endpoints) to accept `[...STAFF_READ_ROLES, "OCC.Compliance"]` — don't widen `STAFF_READ_ROLES` itself, which would silently grant Compliance read access across every other staff endpoint in the app.
- Defaults to Active + Expired shown together; status filter for all five states + All, same `detourStatus.ts` source of truth.
- Search (client-side over `GET /detours` — flagged as an assumption, move server-side if real row counts make a full scan slow) across `number`, `closure`, `riders_directed`, segment `routes`, `reason_code` label, `reported_by`, `approved_by`.
- Filters: status, reason category, severity, source, date range.
- Export: client-side "Download CSV," no new backend endpoint.
- Optional stretch: an "Activity" timeline merging reported→approved→created→updated→resolved events off the existing timestamp columns (same merge-by-timestamp approach as `otpAuditStream.ts`).

**Also this pass, small and independent of the rest of B7:** move `Detours.tsx`'s sidebar entry (shipped in B2 as a plain top-level `NavLink`) into a grouped "Tools" section of the sidebar nav, rather than sitting flat alongside primary nav items - Claude Code should check `App.tsx`'s current sidebar structure first to confirm whether a grouped-section pattern already exists elsewhere to follow (a labeled heading with indented links underneath), or whether this introduces that pattern for the first time, in which case it should be built generically enough that other utility-style pages could join the same "Tools" group later rather than being Detours-specific. `DetourReports.tsx` (new, this part) goes into the same group from the start.

This page **is** the "communicate to internal teams via website" piece of this pass's ask — internal staff who need to reference active/expired detours get this page rather than a copy of the Excel tracker.

---

## B8. Notification distribution lists (new this pass — pending approval)

Mirrors the `RouteClassification`/`OtpReasonCodes` admin-editable-list pattern rather than hardcoding MVTA's real distribution (Jason Francis / Barbara Derrick / Steven Frich, etc., as seen in the reviewed emails) into code or a migration seed.

**`functions-restapi/sql/migration-0XX-detour-notifications.sql`** (new — exact number assigned at build time. **The current migration head is 023** (`migration-023-missed-trips-detection-and-reasons.sql`); 019 was claimed by B5's `avail_last_seen_at` and 020–023 by OTP/missed-trips work. Every `0XX` placeholder in this document therefore starts at **024** — re-confirm the head at build time rather than trusting this number, since other workstreams add migrations concurrently):
```sql
CREATE TABLE DetourNotificationGroups (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    name        NVARCHAR(100) NOT NULL,  -- e.g. "OCC Leadership", "Contract Operators"
    channel     NVARCHAR(10)  NOT NULL,  -- 'email' | 'teams'
    is_active   BIT           NOT NULL DEFAULT 1,
    updated_by  NVARCHAR(200) NULL,
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_DetourNotificationGroups_Channel CHECK (channel IN ('email', 'teams'))
);

CREATE TABLE DetourNotificationRecipients (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    group_id    UNIQUEIDENTIFIER NOT NULL REFERENCES DetourNotificationGroups(id),
    -- for channel='email': display_name + email populated, teams secret name null
    -- for channel='teams': display_name = channel name, teams_webhook_secret_name populated, email null
    display_name      NVARCHAR(200) NOT NULL,
    email              NVARCHAR(320) NULL,
    -- NOT the webhook URL itself. A Teams Incoming Webhook URL IS a secret
    -- (holding it is sufficient to post to the channel), and a SQL column
    -- cannot be a Key Vault reference - that is an App Service app-setting
    -- feature, not something the database resolves. This column holds the
    -- NAME of a Key Vault secret; detourNotify.ts resolves it at send time
    -- via the Function App's managed identity, the same way the SQL
    -- connection string is already handled. The URL never lands in the DB,
    -- in an API response, or in the console.
    teams_webhook_secret_name NVARCHAR(120) NULL,
    is_active   BIT NOT NULL DEFAULT 1,
    sort_order  INT NOT NULL DEFAULT 0
);
```
- **Frontend**: new section in `Admin.tsx` (same table-with-inline-fields-plus-save pattern as `RouteClassification`) — create/edit groups and their members. `shared/types.ts`/`api.ts` get `DetourNotificationGroup`/`DetourNotificationRecipient` types + CRUD methods.
- **API**: `GET/POST/PATCH/DELETE /detour-notification-groups` (`ADMIN_ROLES` — this is org-structure configuration, not day-to-day detour entry).
- Seed with MVTA's real distribution list once confirmed with Ty — **not** hardcoded from the names visible in the reviewed emails without his explicit sign-off, since Cc lists in a forwarded email aren't necessarily the intended standing distribution.

## B9. Notification drafting + send — email and Teams (new this pass — pending approval)

**Open decision, explicitly unresolved per Ty's direction:** how outbound email actually gets sent. This design defaults to **Microsoft Graph `sendMail`** from a shared MVTA mailbox, using the same Entra app registration / federated-credential pattern already established for this project's CI/CD (no new secret type introduced) — **flagged as a decision to confirm before B9 is built**, not a silent default. If MVTA already has an SMTP relay or SendGrid account in use elsewhere, that's a smaller lift and should be swapped in instead; Claude Code should ask before implementing whichever the actual answer turns out to be, not assume Graph is final.

### Auto-draft generation

The four reviewed emails share one structure, and it maps directly onto data already captured by B1–B3 with **no new required fields**:
1. Greeting + one-paragraph plain-language summary (`closure` + `reason_code` label, if B6 lands + date range).
2. One block per `DetourSegments` row: `routes` as the heading, `directions` as the turn-by-turn body — in the same order/grouping staff already enter them.
3. A stop-closures paragraph, included only if `riders_directed` is populated.
4. Sign-off: static MVTA footer + "Prepared by: {sending staff member's display name}," pulled from `authResult.principal.userDetails` — no new `StaffProfiles` table needed for this. Note `userDetails` is **optional** on `CallerPrincipal` (`userDetails?: string`), so the template needs an explicit fallback rather than interpolating `undefined` into an outgoing email; prefer omitting the "Prepared by" line entirely over emitting a blank or malformed one.

This draft is **always staff-reviewed and editable before sending** — same approve/edit pattern used elsewhere in this project (never auto-send unreviewed), consistent with how the Event module's own Alerts design (a separate workstream) requires human review before anything reaches an external audience.

### API

- `GET /detours/{id}/notification-draft?channel=email|teams` (`STAFF_READ_ROLES`) — returns the auto-generated draft (subject + body for email; message text for Teams) without sending anything, so the frontend can render it into an editable form.
- `POST /detours/{id}/notify` (`PUBLISH_ROLES`) — body: `channel`, `group_id` (or an explicit recipient override), `subject`/`body` (the staff-edited final text). Sends via Graph `sendMail` (email) or an Incoming Webhook POST (Teams — the simplest viable integration; a full Graph `chatMessage` approach is a heavier lift with more permissions and isn't justified unless the webhook proves insufficient), resolving the webhook URL from Key Vault by the secret name on the recipient row rather than reading it out of the database. On success, inserts a `DetourNotifications` row (below) and sets the relevant existing boolean (`email_sent` or `expired_email_sent`, depending on whether the detour's current status is Active/Upcoming vs Expired at send time) for backward compatibility with B1's existing fields and B7's reporting page.
- `GET /detours/{id}/notifications` — history of what was actually sent, for the reporting/audit trail.

### New table: `DetourNotifications`

```sql
CREATE TABLE DetourNotifications (
    id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    detour_id      UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
    channel        NVARCHAR(10)  NOT NULL,  -- 'email' | 'teams'
    group_id       UNIQUEIDENTIFIER NULL REFERENCES DetourNotificationGroups(id),
    recipient_summary NVARCHAR(500) NOT NULL,  -- resolved display list at send time, e.g. "Jason Francis; Barbara Derrick; Steven Frich"
    subject        NVARCHAR(300) NULL,          -- email only
    body_snapshot  NVARCHAR(MAX) NOT NULL,      -- exact text sent, for audit - never regenerated after the fact
    sent_by        NVARCHAR(200) NOT NULL,
    sent_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    status         NVARCHAR(10)  NOT NULL DEFAULT 'sent',  -- 'sent' | 'failed'
    CONSTRAINT CK_DetourNotifications_Channel CHECK (channel IN ('email', 'teams')),
    CONSTRAINT CK_DetourNotifications_Status CHECK (status IN ('sent', 'failed'))
);
CREATE INDEX IX_DetourNotifications_DetourId ON DetourNotifications (detour_id);
```
This becomes the real audit source for "was this communicated and to whom" — a genuine upgrade over the current three static booleans, which only ever recorded a yes/no with no recipient, timestamp, or actual message text. The three booleans stay on `Detours` (B1, already shipped) as quick-glance flags derived from this table, not replaced outright — avoids a breaking change to B1/B2's already-shipped UI.

### Frontend

- `Detours.tsx` detail panel gains a **"Notify"** action per channel (Email / Teams, matching whichever `DetourNotificationGroups` are active) — opens the auto-drafted message in an editable text area (mirrors the review-before-publish pattern used elsewhere in this project), with a group/recipient picker sourced from B8, then Send.
- A small notification history list in the same detail panel, sourced from `GET /detours/{id}/notifications`.
- `Admin.tsx` gets the B8 distribution-list editor described above.

### Explicitly out of scope for B9

- Auto-send on detour creation/update — every send is a deliberate staff action, never automatic, consistent with this project's standing "no unreviewed auto-publish" convention.
- Rider-facing (public) notification — this is the internal-teams channel only; rider-facing distribution continues through the existing Messages pipeline, unrelated to this table.
- Full Microsoft Graph Teams `chatMessage` integration — Incoming Webhook is the Phase 1 approach; revisit only if webhook limitations (e.g., no reply threading, no @mentions) turn out to matter in practice.

---

## B10. Internal detour numbering (new this pass — pending approval)

Format: **`MVTA-DET-YYYY-####`** (e.g. `MVTA-DET-2026-0001`) — `YYYY` is the year the detour's `start_date` falls in *at the time the number is assigned*, `####` resets to `0001` each year. Assigned once at creation, never reused or reassigned, even if the detour is later soft-deleted.

```sql
CREATE TABLE DetourNumberSequences (
    year        INT NOT NULL PRIMARY KEY,
    next_value  INT NOT NULL DEFAULT 1
);
```
- Assignment happens inside `POST /detours` (B2), in the same transaction as the insert. The increment itself is race-safe: `UPDATE DetourNumberSequences WITH (UPDLOCK, ROWLOCK) SET next_value = next_value + 1 OUTPUT INSERTED.next_value - 1 WHERE year = @year`.
  **But the bootstrap is not.** "Insert the year's row first if it doesn't exist" is itself a race — two detours created concurrently in the first minutes of a new year can both find no row and both try to insert, and one gets a PK violation. Do the bootstrap-and-increment as a single atomic `MERGE` on `DetourNumberSequences` with an `OUTPUT` clause, or keep the insert and explicitly catch the duplicate-key error then retry the update once. Either is fine; silently assuming the insert succeeds is not, and the failure only ever appears on Jan 1.
- New `Detours.internal_number` column, distinct from the existing free-text `number` field, which stays as-is per B6's open question about whether `number` already covers MVTA's internal reference — this is a separate, system-generated identifier, not a replacement for it.
  **Add it as `NVARCHAR(20) NULL`, not `NOT NULL`.** `Detours` already holds rows in the dev DB, so a `NOT NULL` column with no default fails outright on migration. The sequence is: add nullable → backfill existing rows (assigning numbers in `created_at` order, per the year each row's `start_date` falls in) → only then tighten to `NOT NULL` in a follow-up migration if desired. Note the backfill must run through the same sequence table it's populating, or the first genuinely new detour will collide with a backfilled number.
- **Reschedule edge case**: if `start_date` is edited to a different year after the number was assigned, the number **stays as-issued** (not reassigned — it may already be in a sent email or Teams post per B9). `Detours.tsx`'s detail panel shows a visible warning when `internal_number`'s year no longer matches `start_date`'s year, so staff notice the mismatch rather than being silently misled by it.
- Surfaces in: the entry form (read-only, shown once assigned), the detail panel, B7's Detour Reports page (searchable/sortable column), and B9's auto-drafted notifications (included in the subject line, e.g. `"Detour MVTA-DET-2026-0001: Washington Ave closure"`).

## B11. Document attachments (generalized) + console preview (new this pass — pending approval)

Extends B3 rather than replacing it - same private-container, SAS-gated, managed-identity-signed access model throughout.

- **`DetourImages` is renamed/generalized to `DetourAttachments`** (migration adds `document_type` alongside the existing columns: `'image' | 'document'`, inferred from `content_type` at upload time) - no change to the underlying access model, just broadened beyond images to PDFs/DOCX/etc. (the annotated map screenshots and closure flyers seen in the reviewed emails are exactly this case).
- **Route naming**: if the table becomes `DetourAttachments`, the three shipped endpoints (`POST /detours/{id}/images/upload-url`, `POST /detours/{id}/images`, `GET /detours/{id}/images`) should move to `/attachments` to match, with the `/images` routes kept as aliases for one release so the shipped `Detours.tsx` keeps working through the deploy gap. Renaming the table while leaving the routes on `/images` is the worse of the two inconsistencies.
- **File size ceiling**: images keep B3's existing client-side-resize-before-upload behavior (phone-photo scale, already designed). Documents get a **higher ceiling** to accommodate scanned multi-page PDFs — a named constant in `blobStorage.ts` (e.g. `MAX_DOCUMENT_UPLOAD_BYTES`, suggest starting around 20MB, easy to tune once real file sizes are seen), enforced both client-side (reject before attempting upload) and server-side (validate `size_bytes` on the attachment-create endpoint, don't trust the client alone). Note the server-side check validates the *claimed* `size_bytes`, not the actual blob — the client uploads straight to Blob Storage via SAS, so a client that lies about the size still gets its bytes stored. If a hard ceiling actually matters, it has to be enforced on the container, not in the API.
- **Console preview** (this pass's actual build target): the existing detail panel's thumbnail row extends to a generic attachment list — images render inline as today; PDFs/documents render in a browser-native inline viewer (`<iframe>`/`<embed>` pointed at the SAS read URL - no new dependency) with a "download" fallback link, rather than forcing a download to view.
- **Website/public preview: explicitly deferred, not built this pass.** Per Ty's direction, active detours are already published to riders via Avail CAD - a separate, existing channel - so this module doesn't need to solve public-facing document distribution right now. **Recorded as a future decision, not dropped:** if a future need arises for OnBoard-hosted attachments to be rider-visible independent of Avail CAD (e.g., a document type Avail CAD can't carry), the open questions to resolve at that time are (a) Active-only vs. Active+Upcoming visibility, (b) a public-read mirror container vs. some other serving mechanism, and (c) per-attachment opt-in (`is_public` flag, defaulting off) given the licensing/bystander-privacy concern B3 already flagged for phone photos. Nothing below builds toward this - it's a placeholder for later, not partial scaffolding.

---

## Files to touch/add (B6 onward — B1–B5 already shipped)

Every `0XX` below starts at **024** (head is 023 — re-confirm at build time).

- ~~**B4/B5**~~: already shipped — `functions-restapi/src/lib/availDetoursFeed.ts`, `src/functions/availDetoursSync.ts`, `sql/migration-019-detour-avail-last-seen.sql`. No new files.
- **B6/B7**: `functions-restapi/sql/migration-0XX-detour-reporting-fields.sql` (new), `src/functions/detoursList.ts` (extend — add `OCC.Compliance` to the read role, fixing the shipped 403), `src/functions/detourReasonCodes.ts` (new), `detoursCreate.ts`/`detoursUpdate.ts`/`detoursList.ts` (extend), `src/lib/validation.ts` (extend), `frontend/packages/onboard-console/src/routes/Detours.tsx` (extend — new fields, search box, Clone action), `frontend/packages/onboard-console/src/routes/DetourReports.tsx` (new), `App.tsx` (extend — sidebar "Tools" grouping)
- **B8/B9**: `functions-restapi/sql/migration-0XX-detour-notifications.sql` (new), `src/functions/detourNotificationGroups.ts` (new), `src/functions/detourNotificationDraft.ts` (new), `src/functions/detourNotify.ts` (new), `src/lib/graphMail.ts` (new, pending B9's send-mechanism decision), `src/lib/teamsWebhook.ts` (new), `frontend/packages/onboard-console/src/routes/Admin.tsx` (extend — B8 group editor), `Detours.tsx` (extend — Notify action + history)
- **B10**: `functions-restapi/sql/migration-0XX-detour-numbering.sql` (new — `DetourNumberSequences` table + `Detours.internal_number` column), `src/functions/detoursCreate.ts` (extend — number assignment inside the create transaction)
- **B11**: `functions-restapi/sql/migration-0XX-detour-attachments.sql` (new — rename/extend `DetourImages` → `DetourAttachments`, add `document_type`), `src/lib/blobStorage.ts` (extend — `MAX_DOCUMENT_UPLOAD_BYTES` constant, server-side size validation), `frontend/packages/onboard-console/src/routes/Detours.tsx` (extend — generic attachment list + inline PDF/doc viewer)
- **All**: `frontend/packages/shared/src/types.ts`/`api.ts` (extend throughout), `App.tsx` (nav for `DetourReports.tsx`), `CHANGELOG.md`, `HANDOFF.md`

## Recommended build sequence

0. **Provision Blob Storage and prove B3 actually works** — owner action, blocks B11 entirely and is the only thing standing between B3's shipped code and B3 being real. Do this before treating any attachment work as buildable.
1. ~~**B4–B5** (Avail sync)~~ — **already shipped** (`aa04b9d`). Remaining work is verification only: confirm `AVAIL_DETOURS_URL` is set and that the sync is returning non-zero detours against live data.
2. **B10** (detour numbering) — cheap, no dependencies, and every other part benefits from having `internal_number` available (B7's reporting page, B9's notification subject lines) - worth doing early even though it was the last thing specified. Mind the nullable-then-backfill migration order above.
3. **B6** (reporting fields) — needs the field-list confirmed against MVTA's real internal form first (see open questions).
4. **B7** (reporting page) — small once B6 exists; include `internal_number` as a column from the start. Fix the `OCC.Compliance` read-role gap first; it's a one-line change that also repairs the already-shipped page.
5. **B11** (document attachments) — extends B3, so **blocked on step 0**: its whole build target (inline PDF preview off a SAS read URL) cannot be verified without a real storage account. Independent of B6–B10 otherwise.
6. **B8** (distribution lists) — cheap, admin-only, unblocks B9; needs MVTA's real distribution list confirmed before seeding.
7. **B9** (notify/send) — last, since it depends on B8 and on the still-open email-sending-mechanism decision; natural pause point for infra sign-off (new Graph permission scope or new SMTP/SendGrid credential, either way a real infra change to flag before building).

## Verification (per part, as each is implemented)

- `npm run build && npm test` in `functions-restapi` — new tests for `validateDetourReport` (B6), the notification-draft template builder (B9, pure-function-testable independent of the actual Graph/webhook call).
- `npm run build` in `frontend`.
- Browser pass per part: reason-code dropdown + Clone action (B6); Detour Reports search/filter/export against real data (B7); Admin.tsx group editor (B8); Notify action producing a correct auto-draft from a real detour's segments, editable, and a mocked send recorded in `DetourNotifications` (B9); a new detour receiving the correct `MVTA-DET-YYYY-####` number, and a rescheduled detour correctly showing the year-mismatch warning (B10); a PDF attachment uploading past the higher document ceiling and previewing inline in the detail panel (B11).
- **Owner actions (blocking, live environment):**
  1. **Approve and deploy `storage-detour-images.bicep`** (new billable resource — Standard_LRS StorageV2, realistically under a dollar or two a month at this volume) and set `DETOUR_IMAGES_STORAGE_ACCOUNT`. This unblocks B3 for the first time and is a hard prerequisite for B11. Full runbook in `HANDOFF.md`.
  2. Run each part's migration against the dev DB in sequence, confirming the actual current migration head first (**head is 023 as of 2026-08-06**; B6/B8-B9/B10/B11 all add new migrations — do not assume sequential numbers without checking, other workstreams add them concurrently).
  3. Confirm the email-sending mechanism (Graph shared mailbox vs. existing relay/SendGrid) before B9 is built — currently unresolved.
  4. If Graph is confirmed: approve the new `Mail.Send` application permission on the existing Entra app registration (a real permission-scope change, not just code).
  5. Verify `AVAIL_DETOURS_URL` is set on `func-mvta-restapi-dev` (B4 is built and committed; only this setting and a live-data sanity check remain).
  5. Confirm MVTA's real detour-reporting field list (B6) and real internal distribution list(s) (B8) before seeding either — do not seed from names visible in forwarded emails without explicit sign-off.
  6. Provision a Teams Incoming Webhook per channel MVTA wants notified (B9) — an MVTA-side Teams admin action, not something Claude Code can do from the repo — then store each URL as a Key Vault secret and record only the secret *name* in `DetourNotificationRecipients` (see B8). The URL itself should never be pasted into the console or the database.
  7. Deploy code per part.

## Summary of what needs a decision before B6 onward is built

1. Are the B6 draft reporting fields (reason category, severity, reported/approved by+at, three new notification-channel flags, resolution notes) actually what MVTA's internal workflow tracks, or does the real form differ? Still the single biggest unknown carried over from the original spec.
2. Is `approved_by`/`approved_at` a real step, or should it be dropped?
3. New separate "Detour Reports" page (B7, recommended) vs. filters added directly to the existing page?
4. Client-side search/export (B7) acceptable, or does real detour volume need server-side search?
5. Graph shared mailbox vs. existing relay/SendGrid for B9's email sending — **still unresolved**, drafted with Graph as the default per Ty's direction.
6. What is MVTA's real internal distribution list for detour notifications, and does it differ by detour type/severity, or is one list sufficient to start?
7. Which Teams channel(s), if any, should receive detour notifications, and who at MVTA can provision the Incoming Webhook?
8. ~~Numbering format~~ — **confirmed**: `MVTA-DET-YYYY-####` (B10).
9. ~~Public/website preview of active-detour attachments~~ — **deferred, not built this pass**: detours are already published to riders via Avail CAD, a separate existing channel. Recorded in B11 as a future decision (Active-only vs. Active+Upcoming visibility, serving mechanism, per-attachment public opt-in) to revisit only if a real need for OnBoard-hosted rider-facing documents arises independent of Avail CAD.
10. ~~Document file-size ceiling~~ — **confirmed**: higher than the image ceiling, to accommodate scanned multi-page PDFs (B11 suggests ~20MB as a starting constant, tune once real file sizes are seen).
11. **Approve the Blob Storage deploy** (blocks B3 from ever working and blocks B11 entirely) — the only *infra* decision outstanding, and the cheapest one on this list.
12. **`OCC.Compliance` and detour edit access.** Compliance currently sits in `App.tsx`'s detour nav roles but in neither `STAFF_READ_ROLES` nor `PUBLISH_ROLES`, while the shipped image endpoints gate on `[...PUBLISH_ROLES, "OCC.Compliance"]` — so Compliance can attach images to a detour it can neither list nor edit. Decide the intended tier once and make all four surfaces (nav, list, edit, images) agree.
