# Detour & Closure Module — Expansion Design (Draft for Review)

This extends the shipped B1–B11 spec (`detour-module-consolidated-plan.md`). Nothing below changes what's already built — it wraps a new **intake stage** in front of it and a **public display stage** after it, plus two workflow features (templates, conflict rules). Proposed as **B12–B17**; renumber freely.

Status: **DRAFT — not yet sent to Claude Code.**

---

## The full lifecycle, as I understand it

```
[1] DETECTION          [2] INTAKE              [3] CONTROL CENTER      [4] AVAIL / GTFS       [5] PUBLIC
Something happens  →   Monitor person logs  →   Agent reviews,     →   Entered into Avail  →   Riders see it
upstream of any        it in OnBoard before      decides how to         Detour Measure          via GTFS +
system (a road          it hits CAD/control       apply, resolves        module → pushes         (new) Rider
closure notice,          center                    conflicts               to GTFS feed             page/module
contractor call,
police notice, etc.)
```

Today, step [2] only exists informally for some detours (spreadsheet), and step [5] doesn't exist as a rider-facing MVTA-owned surface — Avail/GTFS is the only distribution.

---

## B12 — Intake Stage (pre-CAD)

**Role:** a designated monitor (could be OCC User Admin role, could be a new "Detour Intake" permission — worth deciding) logs a detour candidate *before* it's a control-center decision.

**Proposed intake fields** (separate from the existing `Detours`/`DetourSegments` schema — this is a *pre*-record, promoted to a real `Detours` row once control center acts on it):

- Source of detection (contractor notice, police/city notice, phone call, field report, etc.)
- Description / reason
- Location — street segment(s) affected
- Stops impacted — left side / right side, using the map tool (below)
- Proposed date/time window
- Attachments (reuse `DetourAttachments` from B11)
- Status: `Pending Review` → `Applied` (becomes real detour) / `Rejected` / `Duplicate`

**Open question:** does intake create a real `Detours` row in `Pending` status, or a separate lightweight `DetourIntake` table that only becomes a `Detours` row when control center approves? The second keeps unreviewed noise out of your reporting/search page (B7) and out of anything customer-facing. I'd lean toward a separate table — flag as a decision point.

## B13 — Map Drawing Tool

The big new UI piece. Scope worth pinning down before this goes to Claude Code:

- **Base layer:** existing stops + road segments, sourced from GTFS static or Spare Labs stop data (need to confirm which is source of truth — is Avail or Spare Labs authoritative for stop locations?)
- **Draw interaction:** trace the detour route over the base map (Azure Maps, consistent with the Event Bus Monitoring module's provider choice)
- **Output:** which stops fall inside the drawn path get flagged as "impacted" automatically, cross-referenced against left/right so the intake person isn't manually typing stop IDs
- **Scope guardrail:** is this v1 "draw a line, snap to nearby stops" or full turn-by-turn routing? The former is a much smaller build and probably answers 90% of the need — worth deciding before scoping effort.

## B14 — Conflict Rule Enforcement

System should block or warn when a stop already has an active detour and a second one is being applied to it.

- Trigger point: control-center apply-time (step [3]) **and** Avail/GTFS feed ingestion (step [4]→[5]), since feed-sourced detours reach the same end-user display in B16 and need the same check — not at intake, since intake candidates aren't authoritative yet
- Behavior: hard block, or warning + override with a reason logged? Transit ops usually needs the override path for edge cases — recommend warn + override, not hard block.

### B14a — Manual-entry / Avail build-failure reconciliation (new)

A specific failure mode: a manual detour clears intake, an OCC agent starts building it in Avail, and Avail rejects or can't complete the build because the same stop is already conflicted there. Now there's a manual-side record that thinks it's proceeding, and no corresponding Avail-side record — a gap that matters because both paths feed the same active-detour list and the same dissemination (B16, B9).

This needs a status field on the manual record tracking Avail build state, not just "applied":

- `Pending Avail Build` — passed intake/control-center review, not yet built in Avail
- `Built in Avail` — confirmed present in Avail, now eligible to show as active and go out for dissemination
- `Avail Build Failed` — agent couldn't complete the build (conflict or otherwise); should NOT appear as active or go out for dissemination until resolved

The active-detour list and the dissemination trigger (B9/B15) should only fire off `Built in Avail`, not off control-center approval alone. Otherwise you risk a detour going out to riders/contractor that doesn't actually exist in Avail, or duplicate entries once the agent resolves the conflict and rebuilds it under a different number. Worth deciding: does the agent update status manually after attempting the Avail build, or is there a way to confirm it round-trip (e.g., checking GTFS ingestion picked it up) — manual confirmation is the simpler v1.


## B15 — Spreadsheet Migration + Contractor Email

- Bring the currently-spreadsheet-only detours into the same `Detours`/`DetourSegments` model
- New: email notification to the contractor (Schmitty/SST) — this is additive to B9's internal distribution/Teams notification, same drafting mechanism, different recipient list
- Question: does the contractor need a different set of fields than internal staff, or the same notification content to a different address? Assuming same content, separate list, unless you say otherwise.

## B16 — Public/Rider-Facing Display

**Resolved:** this is not either/or with Avail/GTFS — it's a unified view. Detours reach the app's display through two paths, and both are shown:

1. **Avail-sourced** — detours applied in Avail's Detour Measure module, pulled back in via the GTFS feed
2. **Manually-added** — detours entered directly through this tool (intake → control center, per B12–B14)

Both paths converge on the same display and both are subject to the same conflict check (B14) before reaching the end user — a detour doesn't skip conflict resolution just because it came in through the Avail feed rather than manual entry. This means B14 needs a trigger point on *feed ingestion* as well as on control-center apply-time, not just the latter as originally scoped. See B14a for the specific failure mode where a manual detour is approved but fails to build in Avail.

### Detail/preview requirement (new)

The display page needs to show full detail per detour, not just a summary line — including a **preview of any attachment** sent along with it for dissemination: images, PDFs, or other supplemental documentation (reuses `DetourAttachments` from B11). If a detour went out with a supporting document, the person viewing the active/expired list should be able to see that same document inline, not just know one exists.

Still open — the standalone-page-vs-in-app-module question below, plus whether "end user" here means public riders or internal staff/contractor:

| | **A: Standalone page (like Rider page)** | **B: Module within the app** |
|---|---|---|
| Audience | Public, no auth | Depends on app's existing auth — if OnBoard is internal-only, this wouldn't be rider-facing at all |
| Reuses | Rider page infra/hosting | Existing OnBoard shell, auth, nav |
| Content | Active + expired, searchable, public wording | Same, but likely staff-facing only unless the app has a public-facing surface already |
| Note | Avail/GTFS already does rider-facing publication (per B11 decision to defer public preview) | Would need to confirm this isn't duplicating what GTFS-consuming rider apps already show |

**My read:** B11 already deferred "public/website preview" because Avail CAD handles rider publication. If that's still true, Option A risks duplicating Avail's job. Worth confirming: is the goal (a) a second public surface for riders, or (b) an **internal** "all detours at a glance" view for staff/contractor, distinct from what riders see? Your wording ("displays active and expired detours with all the relevant information," "anybody can go to") leans public, but it's worth a straight answer before committing either way.

## B17 — Templates & Re-establish from Expired

- **Templates:** admin- or agent-curated saved detour configurations (route, segments, standard turn-by-turn) that pre-fill the entry form
- **Re-establish from expired:** open an expired `Detours` row, use its data to pre-fill a new entry, always issues a **new** `MVTA-DET-YYYY-####` number
- This is functionally close to the existing **B7 "Clone as new detour"** action (built for bundled multi-closure notices) — likely the same underlying mechanism (pre-fill from an existing row + force new number), just triggered from a different starting point (expired detour vs. a second closure in one notice). Worth building as one shared "clone/re-establish" function rather than two.

## Workflow: Roles, States, and Ownership (First Pass)

This is the "who does what, when, and what state does it leave the record in" view — meant to close the B14a limbo gap by giving every transition an explicit owner.

### Swimlanes

| Stage | Owner | Trigger | Action | Resulting Status |
|---|---|---|---|---|
| 1. Detection | Anyone (contractor, police/city, field staff, phone call) | Detour-causing event occurs | Informal notice reaches intake monitor | — |
| 2. Intake | Intake Monitor | Notice received | Logs candidate in OnBoard: source, description, location, stops (map tool), proposed window, attachments | `Pending Review` |
| 3. Control Center Review | OCC Agent | New `Pending Review` record appears in queue | Reviews candidate, runs conflict check (B14), decides: apply / reject / mark duplicate | `Approved – Pending Avail Build` / `Rejected` / `Duplicate` |
| 4. Avail Build | OCC Agent | Record is `Approved – Pending Avail Build` | Builds detour in Avail's Detour Measure module | Attempt succeeds → `Built in Avail` <br> Attempt fails (e.g. Avail-side conflict) → `Avail Build Failed` |
| 5. Confirm & Publish | OCC Agent (manual, v1) | Status becomes `Built in Avail` | Confirms build; record becomes eligible for active list + dissemination | `Active – Disseminated` |
| 5a. Failure Handling | OCC Agent | Status is `Avail Build Failed` | Resolves conflict (reschedule, adjust segment, escalate), retries build, **or** kicks back to intake for rework | Loops back to step 4, or `Rejected` if unresolvable |
| 6. Dissemination | System (automated) | Status becomes `Active – Disseminated` | Sends internal notification (B9, Teams) + contractor email (B15) | No status change — triggers side effects |
| 7. Expiration | System (automated, by date) or OCC Agent (manual close) | Detour window ends | Status flips | `Expired` |
| 8. Re-establish | OCC Agent | Viewing an `Expired` or `Active` record | Clones as new detour (B17), assigns new detour number, re-enters at step 2 or 3 | New record starts at `Pending Review` or `Approved – Pending Avail Build` |

### Closing the B14a limbo gap

The risk was: a record sits in `Approved – Pending Avail Build` indefinitely because nobody's explicit job is "go check whether the build succeeded." Two candidate fixes — pick one or combine:

- **Owned handoff:** the same OCC Agent who approves it in step 3 is responsible for step 4/5 in the same session — no handoff, no gap. Simplest, but relies on the agent not getting pulled away mid-task.
- **Stale-record nudge:** anything sitting in `Approved – Pending Avail Build` past some threshold (e.g. 30–60 min) surfaces on a dashboard or sends a reminder — catches the case where the agent got interrupted.

Recommend both: owned handoff as the normal path, stale-record nudge as the safety net.

### Full status list (for the `Detours` table)

`Pending Review` → `Approved – Pending Avail Build` → `Built in Avail` → `Active – Disseminated` → `Expired`

Branches: `Rejected`, `Duplicate`, `Avail Build Failed`

---



1. Intake: new `DetourIntake` table, or `Pending` status on `Detours`?
2. Who performs intake — new role, or existing OCC User Admin?
3. Map tool v1 scope: line-draw + stop-snap, or full routing?
4. Stop/segment source of truth: GTFS static or Spare Labs?
5. Conflict rule: hard block or warn + override?
6. B14a: manual vs. automatic confirmation that a detour actually built successfully in Avail before it's treated as active/disseminated?
7. B16: standalone public page or internal-only module — and does this duplicate Avail/GTFS's existing rider-facing role?
8. B17: confirm shared clone mechanism with existing B7 action is the right call.
9. Workflow: owned handoff, stale-record nudge, or both, for closing the B14a gap?

---

*Draft only — nothing here has been sent to Claude Code. Mark up and send back.*
