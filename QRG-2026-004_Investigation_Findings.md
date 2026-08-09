# QRG-2026-004 (IT On-Call After-Hours Support) — Investigation Findings

**Date:** August 8, 2026
**Prepared by:** Claude, at Tyre Fant's request
**Subject:** Root-cause investigation into content gaps in QRG-2026-004, plus a governance
conflict identified in the proposed QRG-RULES v5 rewrite

---

## 1. Background and context

Tyre uploaded the rendered QRG-2026-004 (IT On-Call After-Hours Support Procedures — Quick
Reference) alongside its source document, `IT_On-Call_SOP.docx`, for review. A comparison
found the QRG omitted several facts that are present in the source SOP, most notably:

- The LOGIS On-Call phone number (763-543-2600) and its voicemail escalation protocol
  (SOP §2.1)
- The LOGIS Critical Hotline (763-543-2662) and named contact (Blake Tyra) for
  server/infrastructure virus threats (SOP §2.4)
- The Appendix A SLA table (response/resolution targets by priority)
- The Leadership row of the Communications table (email notification for outages > 1 hour)
- The device-reimage follow-up step for both phishing and virus/threat incidents

Separately, Tyre shared `QRG-RULES_PROPOSED.md` — a draft replacement for the QRG-RULES
governing document (the free-text row that is injected as the QRG generator's system
prompt) — and asked whether it was ready to submit for approval.

Both threads were investigated together. Initial analysis worked from a stale project
snapshot (`MVTA_Document_AI_Assistant_v5_0_0.html`), which is well behind the current
production app (per project memory, v6.10.0). Tyre subsequently supplied the actual current
source files — `qrg.js`, `blocks.js`, `ai-run.js`, and `docx-extractor.js` — which is what
the findings below are based on. Where earlier analysis (based on the stale snapshot) has
been superseded or confirmed, that's noted explicitly.

---

## 2. Finding A — QRG-RULES v5 is technically accurate, but conflicts with current MVTA-STY-001

### What's correct

QRG-RULES v5's block-type table was verified against `blocks.js`'s `DEFAULT_BLOCK_TYPES`
and matches exactly: `section, body, bullets, numbered, warning, never, info, quote, data,
table, image, divider`. The claim that this is what "the forced tool schema accepts" is
accurate — `qrg.js`'s `aiBlockKeys()` derives the AI's allowed block types directly from
this same object, and the generation call's `systemPrompt` is built directly from the
QRG-RULES governed row (`qrg.js` ~line 1099):

```js
...(qrgRulesDoc?{systemPrompt:`GOVERNING DOCUMENT — QRG-RULES. These are MVTA's approved
conventions for Quick Reference Guides. Treat them as authoritative instructions for
structure and wording. Where they conflict with the task message below, these win.

${qrgRulesDoc}`}:{})
```

So QRG-RULES v5, once approved, genuinely becomes load-bearing exactly as its own framing
claims.

### What's blocking

QRG-RULES v5 states: *"Supplements MVTA-STY-001 §15.5 (QRG design standard) and
PROJ-INST-001 §6.4 (block types). Where this document conflicts with either, those
govern."*

Current MVTA-STY-001 (Rev 36, the latest version in the project) has not been updated to
match the new QRG identity/filing model or block vocabulary:

- **§15.5.4 (Filing):** *"Both the PDF and PNG must be filed in SharePoint alongside the
  parent REF .docx... Suggested filing location: Operations site → Shared Documents →
  _SOPs → [Category] → [REF Folder]."*
  This directly conflicts with QRG-RULES v5's "Outputs and filing" section, which
  describes a QRG as its own controlled document with its own Document ID, registry entry,
  and Team-based Hub folder (Internal/External split) — explicitly *not* filed alongside
  the parent.
- **§6.1** requires every QRG to have a parent REF. QRG-2026-004's own footer lists
  **"Parent SOPs: TECH-073-00"** — a SOP, not a REF — which is already inconsistent with
  this rule as written, suggesting the "parent REF only" constraint is stale in practice.
- **§15.6** documents the old block-type names (`section_header, sub_header, body_text,
  bullet_list, numbered_list, data_grid, warning_callout, never_do, table, column_break`)
  as canonical.

Because QRG-RULES v5 explicitly defers to STY-001 on conflicts, submitting it as-is creates
a governance loop: the "authoritative" document (STY-001) still describes the old filing
model and old block names, which would technically override the new draft's own central
claims under its own deference clause.

**Recommendation:** Pair the QRG-RULES v5 submission with a STY-001 revision (Rev 37)
that updates §15.5.4 (filing/identity model), §6.1 (parent-document requirement), and
§15.6 (block-type list) to match. Submitting QRG-RULES alone leaves it partially
self-defeating.

---

## 3. Finding B — Root cause of the missing content: a list-nesting bug in `docx-extractor.js`

### Ruled out

- **Source character limit.** `qrg.js` defines `SOURCE_CHAR_LIMIT = 30000` and truncates
  `sourceText` at that point (with a UI warning banner when triggered). The SOP extracts to
  ~10,800 characters — nowhere near the limit. Not the cause here, though it remains a real
  constraint for longer source documents generally.
- **Block-count/page-budget pressure.** The generation prompt asks for 18–24 content blocks
  to fill the page. QRG-2026-004 has roughly 15 major blocks — the model had headroom it
  didn't use, so it wasn't forced to cut content to fit a quota.

### Confirmed root cause

`docx-extractor.js`'s `buildStructuredText()` walks `word/document.xml` and converts it to
markdown-like text for the AI. Its list-handling logic is:

```js
else if (node.getElementsByTagName('w:numPr').length) out.push(`- ${text}`);
```

This checks only whether a paragraph **has** list numbering (`w:numPr`) — it never reads
`w:ilvl` (the indent/nesting level stored inside `w:numPr`). Every list item, at any depth,
is flattened to an identical `- text` line with no indentation and no structural signal of
nesting.

The SOP's LOGIS escalation path (§2.1) is nested five levels deep:

```
- Report to the IT Infrastructure team...
  - If unable to contact IT Infrastructure team, reach out to LOGIS as noted below:
    - LOGIS On Call Number: 763-543-2600
      - Choose Network Services in call tree
      - Leave a voice mail including:
        - Your contact information (name, phone number)
        - Device ID and descriptive issue summary
      - They are expected to respond within 30 minutes
```

After extraction, this becomes nine flat, identically-weighted `- ` lines with no
distinction between "top-level instruction" and "phone number three levels inside a
conditional fallback." The text survives — "LOGIS On Call Number: 763-543-2600" is
genuinely present in `sourceText` sent to the model — but every cue that told a human
reader *this specific fact matters, here's when to use it* is gone. To the model, it reads
as one line in an undifferentiated pile of ~40 similar bullets.

This explains the specific pattern of what went missing: facts buried deep in nested
bullets (phone numbers in §2.1/§2.4, the voicemail-content sub-bullets, the reimage
follow-up steps) were lost, while the SLA table and Communications table — real `w:tbl`
elements, handled correctly by the separate `tableLines()` function — should have survived
extraction as actual markdown tables. Since those *also* went missing from the final QRG,
that looks like a second, separate issue: the content was available to the model, but
nothing in the prompt signals that tabular data should always be preserved over prose, and
a flattened, hierarchy-free wall of bullets ahead of it in the source may have crowded out
attention that would otherwise have gone to the tables.

**Contributing factor:** `isHeadingStyle()` only recognizes paragraphs styled
`Heading1/2/3` or `Title`. The SOP's subsections ("1.1 Scheduling and Handoff," "1.3
Incident Response") are bold/indented text, not real Word heading styles — confirmed by
pandoc's independent extraction, which rendered them as blockquotes rather than headings.
So these subsection markers never receive the `## ` prefix either, meaning the model never
sees a clear "everything until the next heading belongs to this subsection" signal —
compounding the flattening problem.

---

## 4. Recommended fixes

1. **Preserve indent depth in `blockLines()`** (`docx-extractor.js`). Read
   `w:numPr > w:ilvl > @w:val` and emit nested markdown (e.g. two spaces of indent per
   level) instead of a flat `- `. This should surface deeply-nested facts like phone
   numbers as clearly-subordinate detail under their parent instruction, rather than as
   noise-level peers to everything else.
2. **Loosen `isHeadingStyle()`** to also match bold-only paragraphs following a
   numbered-heading pattern (e.g. `/^\d+\.\d*\s/` at the start of a short bold paragraph),
   so subsections without a true Word heading style still get grouped correctly.
3. **Regenerate QRG-2026-004 after (1) and (2) land** to check whether the SLA table and
   Leadership comms row return on their own. If they don't, that confirms a second,
   separate gap on the generation side (not extraction) — the model isn't being told that
   tabular/contact data is non-negotiable content. That would need its own fix, e.g. adding
   an explicit rule to QRG-RULES: *any phone number, named contact, or numeric SLA/response
   time present in the source must land in a `data` or `table` block — never summarized
   away.* This could also become an automated advisory check alongside the existing
   `qrgConformance()` checks in `blocks.js` (e.g., a regex scan for phone-number patterns in
   `sourceText` that don't appear in any generated block).
4. **Pair QRG-RULES v5's submission with a STY-001 Rev 37** updating §15.5.4, §6.1, and
   §15.6 to remove the governance conflict described in Finding A.

## 5. Open item, not yet resolved

The Key Systems & Access table cutoff visible in the QRG-2026-004 PNG (values like
"VPN required for all serve...access" truncating mid-word) was traced to the `data` block's
renderer (`qrg.js` `renderBlockInner`, `case 'data'`), which has no truncation logic of its
own — meaning the cutoff is very likely a CSS overflow/white-space issue in whatever
stylesheet styles `.dc-val`. The relevant CSS file has not yet been supplied; this remains
open pending that file.
