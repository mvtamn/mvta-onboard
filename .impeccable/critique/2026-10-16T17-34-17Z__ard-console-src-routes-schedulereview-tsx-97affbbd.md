---
target: Schedule Review page
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/tyrefant/AI Projects/MVTA Onboard/.claude/worktrees/schedule-data-module-93f126/frontend/packages/onboard-console/src/routes/ScheduleReview.tsx"
target_fingerprint: "sha256:5d6d3282e2536571e27e5446bcb8e3942ecba10b2d5673f513b1b2b205906a07"
target_path: /Users/tyrefant/AI Projects/MVTA Onboard/.claude/worktrees/schedule-data-module-93f126/frontend/packages/onboard-console/src/routes/ScheduleReview.tsx
timestamp: 2026-10-16T17-34-17Z
slug: ard-console-src-routes-schedulereview-tsx-97affbbd
---
Method: dual-agent (A: design review agent · B: detector and browser agent)

## Design Health Score: 21/40 (Acceptable)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Route panel mounts ~750 px above the clicked table row, no scroll/focus; 15-25 s loads behind plain text |
| 2 | Match System / Real World | 3 | Strong transit vocabulary; "confirmed", "(3 service days)", "Dep.", "under-run" unexplained |
| 3 | User Control and Freedom | 2 | URL keeps ?route=420 after opening another route; no Show fewer; no Retry |
| 4 | Consistency and Standards | 2 | Hour columns of the two grids offset ~130 px; 490 "same running time all day 0%" vs grid "same all day" |
| 5 | Error Prevention | 2 | Saturday/Sunday offered for weekday-only routes; tiny-sample cells as loud as robust ones |
| 6 | Recognition Rather Than Recall | 2 | Thresholds/owners only in bottom legend; segment rows vs timepoint rows across two grids |
| 7 | Flexibility and Efficiency | 1 | No sort, filter, export/copy; route names are buttons not links |
| 8 | Aesthetic and Minimalist Design | 2 | Lede, 120-word footnote, 11-entry legend repeating the panel, 4 nested boxes |
| 9 | Error Recovery | 2 | Plain messages, migration copy excellent, but no Retry |
| 10 | Help and Documentation | 3 | Inline why/owner/fix/threshold on every check |

## Design Specificity
Specific in substance, generic in form. Detector: 1 finding (side-tab, scheduleReview.css:85, .sr-readings li; judgement call - a callout, not a card). Overlay blocked by CSP script-src 'self'. Browser: light theme 91 text elements fail AA (--text-muted #8a8a82, 3.48:1 / 3.33:1); dark theme focus ring --brand-green 1.86:1 (<3:1). All 40 controls named; all th scoped; 0 px page overflow at 375.

## Priority Issues
1. [P1] Opening a route from the table loses the user (panel mounts above, focus stays, URL stale). Fix: scrollIntoView + focus heading, sync ?route=, links, master-detail at >=1200 px. Command: layout, harden.
2. [P1] Ranking doesn't answer which route is worst (raw count of 11 equal flags, 19/19 flagged, structural flags counted, observed lateness absent). Fix: rank by fixable flags, add observed-confirmed column, sortable, owner filter. Command: shape.
3. [P1] "Same all day" marker clipped by 320 px th max-width at desktop; run-time grid unusable at 375 px (sticky column wider than scroller). Fix: marker before name, two-line labels, min(40vw,320px), title. Command: adapt, polish.
4. [P1] Contrast: light-theme --text-muted < AA (91 elements); dark-theme focus ring 1.86:1. Global tokens. Command: audit, polish.
5. [P2] Evidence grids misaligned (segments vs timepoints, different first-column widths); empty-reading copy over-reassures on 490 (97% late at 3pm shown under "no segment shows a difference"); tiny samples unfaded. Command: clarify.

## Persona Red Flags
Alex: no sort/filter on 13 columns; table scrolls sideways at 1440 px, Route not sticky; must scroll past lede and What changed; Show all has no way back.
Sam: route panel inserted before the button in DOM, no focus move/aria-controls; Show all and Close drop focus to body; focus ring 1.9:1 dark.
Dana (MVTA service planner): no ranking by running-time wrongness; no copy/export of evidence; tight turnarounds 13 near-identical rows; median recovery hides a bimodal split.

## Minor Observations
No Retry after 504s on 497 (history, observed); grid unmounts on window change; "28 Saturdays" copy for a 28-day window; title appears three times; strong-early swatch louder than strong-late, no colour key; "Dep.", N/S/E/W and the check glyph unexplained; four nested boxes leave ~200 px at 375 px.

## Questions to Consider
- If 19/19 routes are flagged, what is a flag for? Lead with network-wide segments Avail confirms wrong?
- One grid per direction (timepoints down, hours across, scheduled minutes + observed late share per cell) instead of two grids and a footnote?
- Should "Not a schedule fix" checks count toward ranking at all?
