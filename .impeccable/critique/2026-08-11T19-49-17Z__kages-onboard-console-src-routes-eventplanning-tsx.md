---
target: Event Planning module, UI and UX (re-run)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-11T19-49-17Z
slug: kages-onboard-console-src-routes-eventplanning-tsx
---
# Event Planning Surface Critique — Re-run

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Per-panel feedback now confirmed live and working, but a lapsed session shows only the raw string "Not authenticated." with a "Try again" button that will fail identically. |
| 2 | Match System / Real World | 4/4 | Precise, non-substitutable domain vocabulary throughout ("SpecialEvent route," "geofence direction rule," confirm-dialog copy naming real operational consequences). |
| 3 | User Control and Freedom | 2/4 | Confirmations now gate the three high-stakes actions (fixed), but a new issue surfaced: switching the operating-period dropdown mid-edit silently discards unsaved name/date edits via `useEffect([plan?.id])` — no dirty check, no undo. |
| 4 | Consistency and Standards | 3/4 | Lifecycle stepper now uses `aria-current` + CSS classes consistently (fixed); remaining gap is panels 1–2 numbered "1./2." while panels 3–4 (Lifecycle, Resources) aren't. |
| 5 | Error Prevention | 3/4 | Dedupe guard and confirmations now in place (fixed); no change to bulk-input mistakes like duplicate route selection across sessions. |
| 6 | Recognition Rather Than Recall | 3/4 | Readiness checklist and linked-resource counts still hold up; undermined on mobile where stage labels truncate away (see P0 below). |
| 7 | Flexibility and Efficiency | 2/4 | Unchanged — still one-at-a-time resource linking with a full reload per add, no bulk selection, no event/period templates. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Text-size and padding fixes confirmed live (detector's undersized-text findings dropped from 7 to 0); once a plan exists, four dense panels still stack on one long page. |
| 9 | Error Recovery | 2/4 | `loadError` retry with `role="alert"` still solid for load failures, but the specific 401/session-expired case has no distinct message or path forward. |
| 10 | Help and Documentation | 1/4 | Unchanged — no tooltip or link from "Every linked geofence has a direction rule" to where that's actually configured. |
| **Total** | | **26/40** | **Acceptable, trending toward Good. The fixed items are confirmed fixed; the score reflects two new P0s that deeper live testing surfaced.** |

## Design Specificity Verdict

**LLM assessment:** Clearly authored for MVTA/OCC transit event operations. "SpecialEvent route" classification, geofence "direction rules" with compass headings, "Operating period" vs. Service Plan "revision," and confirm-dialog copy that states real consequences ("This publishes the scope live to riders") are non-substitutable domain vocabulary. This could not be dropped into another product's admin panel unchanged.

**Deterministic scan:** `detect.mjs` reports **clean (exit 0)** on the `.tsx` source of `EventPlanning.tsx` alone and combined with `EventWorkspaceNav.tsx`/`App.tsx` — same as before; it doesn't reach CSS. The **live browser overlay** now reports **13 anti-patterns**, down from 17–18 last pass:
- `undersized-ui-text` findings: **0**, down from 7 — confirmed fix (`.event-workspace-kicker` and `.event-workspace-stages small` both measured live at 11px now).
- The original `low-contrast` finding (1.9:1, `#00553d` on `#152219`) is **gone**. The active workspace stage now measures `rgb(25,59,44)` background / `rgb(95,191,143)` text ≈ **5.5:1**, confirmed independently by both this run's Assessment A and B — the `--success-bg`/`--success-text` fix holds.
- **New near-miss**: `low-contrast` — 4.4:1 (needs 4.5:1), text `#8aa096` on `#193b2c`. Root cause: `.event-workspace-stages small` declares its own `color: var(--text-muted)`, which wins specificity over the parent anchor's hover/active `color: var(--success-text)` — so the stage sub-label text stays muted-gray on the now-tinted hover/active background. It's 0.1 short of AA and affects secondary caption text, not primary content — flagging as real but minor.
- **2× `nested-cards` — likely false positive.** Traced to `MockAuthProvider.tsx`: a `position: fixed` dev-only debug widget (explicitly tree-shaken out of production via `import.meta.env.DEV`, per its own header comment) that floats in the bottom-right corner and visually overlaps the page's real cards in the viewport. It isn't a DOM-nested card — it's a fixed-position sibling the detector's geometry check is reading as overlapping. Not fixing; it's not production UI.
- `ai-color-palette` (×2, "cyan neon text on dark background") and `cramped-padding` (×1) persist unchanged from last pass and are outside anything touched this round — not investigated further here.

## Overall Impression

Every fix from the last pass holds up under independent re-testing: confirmations are live and read the plan name correctly, the CSS contrast bug is genuinely fixed (verified via two independent `getComputedStyle` reads), progressive disclosure works, and the mobile sidebar toggle opens/closes/backdrops correctly. The reason the score (26/40) isn't higher than the fix list might suggest is that fixing the sidebar collapse let this round's testing go two doors deeper into mobile: with the sidebar out of the way, two more severe mobile defects became measurable — the workspace-stage labels truncate to 1-2 visible characters, and the Sign Out button sits entirely outside the reachable viewport with no scroll or wrap. Neither is new damage from this session's edits; both are pre-existing gaps in the same shell that only became visible/measurable once the primary mobile blocker was cleared.

## What's Working

1. **Per-panel feedback holds up.** `FeedbackNote` renders next to the triggering control, not in one shared banner — confirmed in source and matches the intended design.
2. **Consequence-aware confirmations.** The `window.confirm()` copy names the plan and the real stakes ("This publishes the scope live to riders," "This pauses live Event AVL monitoring") rather than generic "Are you sure?" text.
3. **Activation readiness checklist.** Turns a disabled button into an explained one — still the strongest recognition-over-recall element on the page.

## Priority Issues

### [P0] Workspace-stage labels are illegible on mobile

**Why it matters:** Live-measured at 375px: each stage label gets ~16px of rendered width against 23–132px of text needing to fit ("Reusable resources," etc.), so labels render as 1-2 visible characters. This is the primary wayfinding element for the whole Plan→Configure→Activate→Monitor journey, failing exactly where on-call staff are likeliest to check status from a phone.

**Fix:** Give `.event-workspace-stages` its own sub-360px treatment — horizontal scroll-snap, or icon-only markers with the active stage's full label shown separately below — instead of a fixed 4-column grid that ellipsis-truncates.

**Suggested command:** `/impeccable adapt frontend/packages/onboard-console/src/components/EventWorkspaceNav.tsx`

### [P0] Sign Out is unreachable on mobile

**Why it matters:** `.topbar-actions` has no wrap and no responsive collapse; at 375px it renders roughly 455px wide inside a 325px topbar, and since the ancestor `.frame` uses `overflow: hidden`, the overflow is clipped, not scrollable — confirmed live: `document.documentElement.scrollWidth` stays 375 while the Sign Out button's x-position sits past the viewport edge. An operator on a phone cannot sign out.

**Fix:** Collapse `.topbar-actions` behind the same breakpoint that already triggers `.nav-toggle-btn` (860px) — e.g. move session text and the refresh indicator into a secondary row or an overflow menu, keep Sign Out and the avatar visible.

**Suggested command:** `/impeccable adapt frontend/packages/onboard-console/src/App.tsx`

### [P1] Switching the operating-period selector silently discards unsaved edits

**Why it matters:** `useEffect(() => { setPlanName(plan.name); setStartAt(...); setEndAt(...); }, [plan?.id])` fires the instant the dropdown changes, overwriting any in-progress edit with zero dirty-check or confirmation — silent data loss in a tool that gates live rider-facing publishing.

**Fix:** Track whether the current fields differ from the loaded plan; block or confirm the switch when they do.

**Suggested command:** `/impeccable harden frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P1] A lapsed session is a dead end

**Why it matters:** Confirmed live: an expired/absent session renders only the raw string "Not authenticated." with a "Try again" button that re-fires the same request and fails identically — the most common real-world entry state across OCC shift changes, with no path forward.

**Fix:** Special-case a 401 in `loadError` with "Your session has expired — sign in again" and an actual sign-in action, not a retry that can't succeed.

**Suggested command:** `/impeccable clarify frontend/packages/onboard-console/src/routes/EventPlanning.tsx`

### [P3] Stage sub-label text is 0.1 short of AA contrast on hover/active

**Why it matters:** `.event-workspace-stages small` declares its own `color: var(--text-muted)`, which doesn't inherit the parent link's hover/active `color: var(--success-text)` — so the sub-label sits at 4.4:1 against the tinted background (needs 4.5:1). Minor: secondary caption text, 0.1 short.

**Fix:** Add `color: inherit` to `.event-workspace-stages small`, or an explicit hover/active override.

**Suggested command:** `/impeccable typeset frontend/packages/onboard-console`

## Persona Red Flags

**Alex (power user, repeat event planner):** No bulk resource linking — 10 resources means 10 separate select-click-reload cycles. No duplicate/template flow for recurring events. Hit hardest by the new dropdown-reset data loss (P1), since Alex is the one juggling multiple periods in one session.

**Jordan (first-time OCC admin):** Landing mid-lapsed-session sees only the dead-end "Not authenticated." (P1). The readiness item about geofence direction rules gives no link to where that's configured (`EventResourceMapEditor`, a different route). Generic `window.confirm()` dialogs for Activate/Suspend look like routine OS popups, easy to click through without registering the stated consequence.

**Sam (accessibility-dependent):** `.event-plan-steps li.is-past` (completed lifecycle steps) conveys "done" via color only, unlike the workspace-stage marker's ✓ which does get announced. The readiness checklist's "✓"/"!" glyphs have no `aria-label` — a screen reader reads a bare "!" rather than "missing: Event selected." The mobile stage-label truncation (P0) equally breaks low-vision/browser-zoom users at effective narrow widths.

## Minor Observations

- Panels 1–2 are numbered ("1. Choose an Event," "2. Define operating period"); panels 3–4 (Lifecycle, Resources) aren't — an inconsistent wizard scaffold that predates this session's fixes.
- The resource-add row uses inline `style={{ display: "flex", ... }}` rather than a CSS class, inconsistent with the rest of the class-driven stylesheet.
- `event.owning_team`/`event.description` are concatenated into one unlabeled muted line with " · " separators — easy to skim past.
- "Times use your MVTA-local browser time" remains a genuinely good, specific microcopy choice.
- The two `nested-cards` detector findings and the pre-existing `.stat-card` `side-tab` finding and the ~40 design-system-drift findings (no DESIGN.md exists) are unrelated to this session's changes — not investigated or fixed here.

## Questions to Consider

- Should the workspace-stage nav get a genuinely different mobile treatment (icons + one expanded label) rather than trying to shrink the same 4-column layout further?
- Is discarding unsaved operating-period edits on dropdown-switch intentional, or a side effect of reusing a simple `useEffect([plan?.id])` reset pattern?
- Given OCC staff rotate through shifts (and SSO sessions lapse accordingly), should session expiry get a first-class recovery flow across the whole console, not just this route?
