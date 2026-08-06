# MVTA OnBoard — Detour reporting fields + Active/Expired reporting page: spec

**Status: DRAFT, for review only.** Nothing in this document has been built. Per Ty's
instruction, this is spec-first — no migration, code, or UI ships until this is reviewed
and explicitly approved to execute, section by section or all at once.

## Context

Two asks, on top of the already-shipped Detour & Closure module
(`detour-module-build-brief.md` Parts B1–B3, migration-017):

1. Additional `Detours` fields to match **MVTA's internal ops reporting workflow** for a
   detour/closure — distinct from the Avail feed fields (`Cause`/`Effect`/Avail's own
   `CreatedBy`/`UpdatedBy`) that the original build brief already flagged and deferred as
   "not required for MVP." This spec does not touch those Avail-only fields.
2. A new internal page for **active and expired detours**, **searchable**.

**Important caveat on part 1:** there's no existing document in this repo describing
MVTA's actual paper/internal detour-reporting form, and I don't have it. Everything below
under "New fields" is a draft built from standard transit-ops reporting practice
(reason/cause categorization, severity, who-reported/who-approved, notification channels,
resolution notes) layered onto the fields the existing Excel tracker already uses
(`Number`, `Closure`, `RidersDirected`, the three `*_emailed` flags). **Treat every field
below as a proposal to correct, not a confirmed requirement** — the easiest way to fix
this spec is to mark up field names/options directly against what the real internal form
looks like.

---

## Part 1 — New reporting fields

### New table: `DetourReasonCodes`

Mirrors `OtpReasonCodes` (migration-018) exactly — same admin-editable-list pattern
already built and shipped for OTP's exclusion reason codes, applied here instead of a
hardcoded enum so Administration can add/retire categories without a code change.

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

Draft seed values (**confirm against MVTA's real categories**):
`construction`, `accident_crash`, `weather`, `special_event`, `utility_work`,
`city_county_project`, `parade_race`, `other`.

### New columns on `Detours`

| Column | Type | Purpose |
|---|---|---|
| `reason_code` | `NVARCHAR(30) NULL` | Soft reference to `DetourReasonCodes.code` (same non-FK convention as `OtpStopExclusions.reason_code`) — why the closure happened. |
| `severity` | `NVARCHAR(10) NULL`, `CHECK (severity IN ('minor','moderate','major'))` | Rider-impact level. Draft 3-tier scale — confirm whether MVTA uses a different scale or none at all. |
| `reported_by` | `NVARCHAR(200) NULL` | Who first reported/detected the closure — may differ from `created_by` (who entered it into OnBoard), if there's a lag between report and data entry. If that lag never actually happens in practice, this field (and `reported_at`) may be redundant with `created_by`/`created_at` — worth confirming before building. |
| `reported_at` | `DATETIME2 NULL` | When it was first reported/detected. |
| `approved_by` | `NVARCHAR(200) NULL` | Sign-off before the detour/closure goes live to riders — **only add this if a real approval step exists today**; if any OCC.Publisher posting it *is* the approval, this field is unnecessary. |
| `approved_at` | `DATETIME2 NULL` | Timestamp for the above. |
| `radio_notified` | `BIT NOT NULL DEFAULT 0` | Extends the existing `email_sent`/`expired_email_sent`/`spare_emailed` three-boolean convention already in the table — one flag per real notification channel, not a free-text list. |
| `dispatch_board_notified` | `BIT NOT NULL DEFAULT 0` | Same pattern. |
| `social_media_notified` | `BIT NOT NULL DEFAULT 0` | Same pattern. |
| `resolution_notes` | `NVARCHAR(1000) NULL` | Free-text notes on how/why it closed — filled in around the time a detour moves to Expired. |

**Open question, not a build blocker:** the existing `number` field (free text — "951",
"Operator Message", "993 & 994") may already function as MVTA's internal reference
number. Before adding a separate `internal_reference_number` column, confirm whether
`number` already covers that need — my default assumption is it does, so this spec does
**not** add a new column for it.

### Backend

- `functions-restapi/src/functions/detourReasonCodes.ts` (new) — `GET
  /detour-reason-codes?active_only=`, `POST`/`PATCH` (`ADMIN_ROLES`), mirroring
  `otpReasonCodes.ts` exactly.
- `detoursCreate.ts`/`detoursUpdate.ts` — accept the new fields; `validation.ts` gets a
  `validateDetourReport` guard-clause validator for `severity`'s check-constraint values.
- `detoursList.ts` — return the new fields on `Detour`.
- No new audit-log table: `reported_by/at`, `approved_by/at`, `created_by/at`,
  `updated_by/at` on the row itself **are** the audit trail, same "the record is the audit
  trail" approach already used for `AuditLog.tsx`/`adminMessages.ts` and OTP's
  `otpAuditStream.ts`. If Part 2's reporting page wants a cross-detour timeline view, it
  reads directly off those existing timestamp columns — no new table needed for that
  either.

### Frontend

- `Detours.tsx` entry form gains: reason-code dropdown (from
  `GET /detour-reason-codes?active_only=true`), severity select, reported-by/reported-at,
  approved-by/approved-at, the three new notification checkboxes (next to the existing
  three), resolution notes (shown once end date has passed / status is Expired).
- Detail/expand panel surfaces the same fields read-only, alongside the existing
  `riders_directed`/segments/images.
- `shared/types.ts` — extend `Detour`/`CreateDetourInput`, add `DetourReasonCode` type +
  `api.ts` methods, mirroring `OtpReasonCode`/`otpReasonCodes` exactly.

---

## Part 2 — Active/Expired reporting page, searchable

### Decision: new page, not a rework of the existing one

`Detours.tsx` ("Detours & Closures") stays the day-to-day **entry/edit** workspace —
status tabs, new/edit form, delete. Recommend a **new, separate, read-only page** —
"Detour Reports" — for a likely-different audience (compliance/ops leadership who need to
search and reference detour history without edit controls in the way). This also avoids
the entry page accumulating reporting-only chrome (export, date-range filters) that
day-to-day data entry doesn't need.

One small addition lands on the *existing* page regardless of this decision: a plain text
search box over the table already on screen — cheap, useful immediately, doesn't wait on
the new page.

### New page: "Detour Reports"

- Nav: new item under the same section as "Detours & Closures", read-only —
  `STAFF_READ_ROLES` + `"OCC.Compliance"` (no write actions at all; editing still only
  happens on the existing page).
- Defaults to **Active + Expired** shown together (per the ask); status filter available
  for all five states + All, same computed `DetourStatus` values, same
  `detourStatus.ts`-backed source of truth — no second status definition.
- **Search** (client-side over the already-small `GET /detours` result set — flagging
  this as an assumption: if the live detour count is large enough that a full client-side
  scan feels slow, this should move to a server-side search param instead; I don't have
  visibility into current row counts to know which applies) across: `number`, `closure`,
  `riders_directed`, segment `routes`, `reason_code` label, `reported_by`, `approved_by`.
- **Filters**: status, reason category, severity, source (manual/avail), date range
  (overlaps `start_date`/`end_date`).
- **Export**: a "Download CSV" button, client-side (no new backend endpoint) — same
  minimal-footprint approach as the rest of this module (no new dependency).
- Optional stretch, only if useful: an "Activity" section listing
  reported→approved→created→updated→resolved events across all visible detours in one
  timeline, sourced directly from the timestamp columns above (same merge-by-timestamp
  approach as `otpAuditStream.ts`, still no new table).

### Files to add/touch (once approved)

- `functions-restapi/sql/migration-0XX-detour-reporting-fields.sql` (new — exact number
  assigned at execution time; migration 019 may already be claimed by the in-progress
  Avail Detours sync work, paused mid-session for this spec)
- `functions-restapi/src/functions/detourReasonCodes.ts` (new)
- `functions-restapi/src/functions/detoursCreate.ts`, `detoursUpdate.ts`, `detoursList.ts` (extend)
- `functions-restapi/src/lib/validation.ts` (+`validateDetourReport`, +tests)
- `frontend/packages/shared/src/types.ts`, `api.ts` (extend `Detour`, new `DetourReasonCode` type/methods)
- `frontend/packages/onboard-console/src/routes/Detours.tsx` (new fields in form/detail, search box)
- `frontend/packages/onboard-console/src/routes/DetourReports.tsx` (new page)
- `App.tsx` nav/route registration for the new page

### Verification (once approved to execute)

- `npm run build && npm test` in `functions-restapi` (new validator + reason-code tests).
- `npm run build` in `frontend`.
- Browser pass: add the new fields on a detour, confirm they persist and surface in the
  detail panel; confirm the new page's search/filter/export against real data; confirm a
  reason code added in Administration shows up in the entry form's dropdown.
- **Owner action (blocking):** run the new migration against the dev DB before deploy —
  same as every other migration in this project.

---

## Summary of what needs a decision before this gets built

1. Are the draft fields above (reason category, severity, reported/approved by+at, the
   three new notification flags, resolution notes) actually what MVTA's internal
   reporting workflow tracks — or is the real form different? This is the biggest
   unknown in this whole spec.
2. Is `approved_by`/`approved_at` a real step, or should it be dropped?
3. Does `number` already serve as MVTA's internal reference number (skip a new column), or
   is a distinct reference number needed?
4. New separate "Detour Reports" page (recommended) vs. adding search/filters directly
   onto the existing "Detours & Closures" page instead?
5. Client-side search/export (simplest, no new endpoint) acceptable, or does the real
   detour volume need server-side search/pagination?
