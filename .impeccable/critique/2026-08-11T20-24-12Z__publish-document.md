---
target: Publish Document (MVTA Document AI app; evaluated from screenshots, not in this repo)
total_score: 20
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-08-11T20-24-12Z
slug: publish-document
---
Method: dual-agent (A: design-review sub-agent · B: detector/evidence sub-agent)

> **Scope note**: "Publish Document" belongs to MVTA's **Document AI** app, which is not part of this repo's tracked frontend source (`onboard-console`, `rider-app`, `shared` were all searched — no match for its routes, sidebar, or copy). This critique was run entirely from three screenshots you provided; there is no live URL or source file. Both automated evidence channels were genuinely attempted and came back empty, not skipped: the CLI detector reported `cannot access Publish Document` (target unreachable, not "no findings"), and no browser injection was attempted since there's no page to load. Both sub-agents worked from an exact, verified transcription of the screenshots as their only evidence.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "0 of 8 steps complete" against a list that only renders 7 rows — the status indicator itself is internally inconsistent. |
| 2 | Match System / Real World | 2 | Strong domain vocabulary (Avail SOP, RequiredSections, style guide §6.2) undercut by "companion" meaning two different things on one screen, and raw `{{REVIEW: ...}}` template syntax shown as user-facing copy. |
| 3 | User Control and Freedom | 3 | Good exits ("Save for later," "Back to SR-015," "Waive review"), but disabled controls (Download DOCX, Finalize) don't link to their own unblocking action. |
| 4 | Consistency and Standards | 1 | All three unresolved-marker rows are numbered "1" instead of 1/2/3 — a direct, provable failure inside a single list, plus the "companion" collision above. |
| 5 | Error Prevention | 3 | Finalize and Download DOCX are proactively gated until preconditions are met — solid guardrails. |
| 6 | Recognition Rather Than Recall | 3 | The scroll-pinned "Finalize is not ready yet" summary is a genuine recognition aid; per-marker Resolve/Copy avoids requiring recall of document content. |
| 7 | Flexibility and Efficiency of Use | 1 | No bulk-resolve across the 3 markers (only "Copy all" is batched), no keyboard shortcuts, one-at-a-time review in a tool built for repetitive governance work. |
| 8 | Aesthetic and Minimalist Design | 1 | The same two facts ("3 unresolved markers," "SharePoint folder unreachable") are restated across four separate surfaces before the user reaches the fix UI. |
| 9 | Error Recovery | 3 | Genuinely strong copy — the SharePoint error names the exact remediation path; marker copy precisely explains re-render vs. DOCX-edit behavior. |
| 10 | Help and Documentation | 1 | "Style guide §6.2" is cited three times as an authority but never linked; no other help surface appears anywhere in the flow. |
| **Total** | | **20/40** | **Acceptable (bottom of band)** |

## Design Specificity Verdict

**LLM assessment**: Authored, not generic — but the authorship stops at vocabulary, not structure. The domain language is real and specific: "Avail SOP," "RequiredSections (Governance Rules → Required Sections)," `APP-SR-015-A`, "Companion 1 of 3 for SR-015," and the grouped nav (WORK QUEUE / CREATE & PUBLISH / DOCUMENT LIBRARY / TOOLS & OVERSIGHT) all reflect real product knowledge and could not be dropped unchanged into an unrelated product. Brand tokens check out against this repo's `DESIGN.md`: the dark evergreen sidebar (#00553D), amber logo accent (signal-amber #F78E1E), and warm off-white canvas match the documented palette, suggesting this is a sibling surface in the same design system. Where it reverts to category-interchangeable: the publishing mechanics themselves — a generic linear step-progress list, four stat tiles, a stack of colored alert banners, disabled buttons with no inline "why" — are the same shape any enterprise document pipeline would ship. And the two concrete defects below (step-count mismatch, triple "1" numbering) suggest the specificity is skin-deep in places: nobody has looked closely enough at these components to notice they're internally inconsistent.

**Deterministic scan**: Unavailable for this target — `detect.mjs` was run and returned `cannot access Publish Document` (a real attempt, not a skip), because this screen lives outside this repo's tracked source. In its place, Assessment B combed the transcription with a detector's rigor and surfaced concrete, quotable contradictions: the 7-vs-8 step count, the 1/1/1 marker numbering, the "companion" double meaning, and four different nouns ("SharePoint folder," "draft folder," "destination library," "Completed library") potentially describing as few as two actual storage locations. None of these need taste to confirm — they're internally provable from the copy alone.

**Visual overlays**: Not available. No live URL exists for this app and no browser automation was attempted — there is no page to inject `detect.js` into. This critique's technical-defect coverage rests entirely on the two sub-agents' independent reading of the transcription, not on live DOM/console evidence. Treat findings 7 and 8 below (PDF download gating, missing "Publish" button) as **unverified** for exactly this reason — the screenshots didn't confirm them either way.

## Overall Impression

The copy-writing instinct here is genuinely good — the SharePoint error and the DOCX-editing-won't-clear-markers explanation are the kind of precise, actionable error text most enterprise tools never bother writing. But the page doesn't trust that instinct: it says the same two blocking facts four times in four visual registers before the user ever reaches the UI that actually fixes them, and two of its own status numbers don't add up (7 rendered pipeline steps under a "0 of 8" label; three marker rows all numbered "1"). The single biggest opportunity is consolidation — one blocking-state summary instead of four, and a correctness pass on the counters this compliance tool's users are meant to trust.

## What's Working

1. **Error and remediation copy is exemplary at the sentence level.** "Choose a reachable SharePoint folder before finalizing... Use Browse SharePoint in Administration → Document Libraries" tells the user exactly where to go, not just that something failed.
2. **Brand and IA fidelity.** The evergreen/amber/warm-canvas palette and domain-grouped nav labels faithfully track this repo's `DESIGN.md` tokens and read as purpose-built for MVTA's operations/compliance domain, not a generic admin shell.
3. **The scroll-pinned "Finalize is not ready yet" summary** is a smart pattern — it keeps the blocking-state visible near the point of action on a long page, even though right now it's one more voice in an already-crowded chorus.

## Priority Issues

**[P1] All three unresolved-marker rows are numbered "1."**
- **Why it matters**: In a tool whose entire value proposition is precise governance tracking ("3 unresolved markers," "3 placeholders," specific style-guide citations), a broken counter erodes trust in every other number on the page, and makes it impossible to reference "marker 2" in a review conversation without quoting the full placeholder text.
- **Fix**: Correct the list index/key binding so each row renders its actual position (1, 2, 3), not a hardcoded or reused value.
- **Suggested command**: `/impeccable harden`

**[P1] "0 of 8 steps complete" contradicts a pipeline list that only renders 7 rows.**
- **Why it matters**: This is the system's own visibility-of-status number disagreeing with itself, in a compliance tool where "does the number match reality" is the whole point. Either a step is silently missing from the audit trail, or the count label is simply wrong — neither is acceptable in a workflow that ends in "Finalized to completed."
- **Fix**: Verify against the live step-definition source (is there a genuine 8th step not rendering, or is the subtitle's total hardcoded/stale?) and make the two numbers match.
- **Suggested command**: `/impeccable harden`

**[P1] The same two blocking facts are restated across four surfaces, using four different nouns for what may be the same location.**
- **Why it matters**: "3 unresolved review markers" and the SharePoint-folder problem appear in the top error banner, the top warning banner, the Finalize card, and the pinned floating box — before the user ever reaches the actual per-marker fix UI, three scroll-screens down. Along the way, the same missing-configuration issue is called a "SharePoint folder," a "draft folder," a "destination library," and a "Completed library" — a user trying to fix the blocking error has no way to confirm whether these are 2 places or 4. This directly violates both Single Focus (cognitive load) and Consistency and Standards, and risks alarm fatigue in a "calm control room" brand that explicitly commits to signal over decoration.
- **Fix**: Collapse to one persistent blocking-state summary with a direct link to the fix UI, and standardize on one term per actual storage location.
- **Suggested command**: `/impeccable distill`

**[P2] "Companion" means two different things on the same screen.**
- **Why it matters**: "Companion 1 of 3 for SR-015" (this document's position in a related-document set) and the "COMPANIONS: 0" stat tile (an apparently unrelated per-document count) share one word with no disambiguating label. In a domain built on precise vocabulary, this creates a false "is something broken?" moment for a compliance reviewer skimming the page.
- **Fix**: Rename one of the two usages — e.g. "Set position: 1 of 3" vs. "Linked companions: 0."
- **Suggested command**: `/impeccable clarify`

**[P2] Raw template syntax is shown as user-facing copy.**
- **Why it matters**: Literal `{{REVIEW: ...}}` and `{{REVIEW}}/[Insert]` tokens are displayed directly to the document's author ("Ashley Watermolen," credited under "Operations," not engineering). A non-technical user seeing raw double-curly-brace markup may reasonably read it as a corruption or system error rather than an intentional, resolvable placeholder.
- **Fix**: Translate the marker into plain language in the visible copy (e.g. "Missing: Appendix content") while keeping the literal token as a technical detail behind a disclosure, matching the pattern already used for the SharePoint error's "Show technical details" toggle.
- **Suggested command**: `/impeccable clarify`

## Persona Red Flags

**Alex (Power User)**: No bulk-resolve exists for the 3 markers — only "Copy all" is batched, while "Resolve" stays per-row, forcing three separate clicks for what should be a five-second review pass. There's no jump-link from the top banner's "3 unresolved review markers" straight to the markers card; Alex has to scroll past Contractor Review and Finalize to reach what the banner already told them about. No keyboard-shortcut pattern is evident anywhere for Render/Save/Download.

**Sam (Accessibility-dependent)**: Severity is conveyed by banner hue (red vs. amber) with no confirmed accompanying icon or severity word beyond the sentence itself — a low-vision or colorblind user has to read full copy to rank urgency. Each pipeline step's "small gray/inactive dot" is a color/fill-only state indicator with no confirmed text equivalent ("not started" vs. "in progress"). The scroll-pinned Finalize summary duplicating the inline Finalize card is a real risk of conflicting or doubled screen-reader announcements unless one instance is explicitly hidden from the accessibility tree.

**Jordan (First-timer — plausibly the document's own author)**: Heavy unexplained jargon ("governed workflows," "RequiredSections (Governance Rules → Required Sections)," raw `{{REVIEW: ...}}` syntax) with no inline glossary or tooltip. The critical warning that "editing the downloaded DOCX will not clear markers — re-render rebuilds from stored content, not that file" is buried in body text on the markers card, three screens after the Download DOCX button that would tempt exactly the wrong workflow — a first-timer will hit this trap before ever reading the warning that prevents it. "Waive review" sits as a plain outline button with the same visual weight as "Save draft," with no confirmation step described for what is presumably a governance-relevant decision to skip contractor review entirely.

## Minor Observations

- "Download DOCX" sits visibly disabled between two enabled render buttons with no adjacent explanation of why (must render first) — a one-line hint would remove the guesswork.
- The byline "APP · Operations · Ashley Watermolen" stacks a doc-type code, department, and person's name with only dots as separators — fine for expert scanning, opaque cold.
- Page subtitle uses Title Case mid-sentence ("Render, Upload, And Complete Generated Documents") while surrounding body copy uses standard sentence case — a small, provable style inconsistency sitting in the most visible text on the screen.
- "Download PDF"'s disabled/enabled state relative to "Render PDF" was not clearly confirmable from the screenshots (unlike "Download DOCX," which was visibly grayed out) — worth a direct check that PDF download is gated the same way DOCX download is.
- The pipeline's "PUBLISH" stage groups four steps (Upload draft, Database log, Registry status updated, Audit log) under one label, but no button on the page is itself labeled "Publish" — worth confirming whether "Save draft" is the button that triggers this described behavior, since the terminology doesn't currently connect the two.

## Questions to Consider

- If the top of the page can already state "3 unresolved review markers" and "SharePoint folder unreachable" before any scrolling, why restate both facts three more times on the way down — what would this screen look like with exactly one dismissible blocking-state summary instead of four?
- Is "COMPANIONS: 0" surfacing a real, distinct relationship the product needs to expose, or is it a badly-named stat tile that happens to collide with "Companion 1 of 3" a few inches above it?
- Given "0 of 8" against 7 visible rows: is there truly a hidden 8th step nobody's shown, or has this progress bar been silently wrong every time someone has opened this page? Either way, what does it say that neither has been caught yet in a compliance-grade publishing tool?
