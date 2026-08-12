# Control Center Decision Matrix feature evaluation

**Reviewed:** 2026-08-12
**Scope:** `frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx`, its data/CSS modules, OCC Tools navigation, and the existing Decision Matrix improvement proposal.

## Executive summary

The Decision Matrix is currently a read-only reference surface inside the
OCC Tools page. It provides local search, filters, three presentation modes,
severity indicators, and links to governing documents. It is a useful first
reference experience, but it is not yet a governed operational decision
system: the matrix data is bundled in the frontend, the QRG is explicitly
partial, several QRG links are placeholders, and there is no way to record
acknowledgement, actions, escalation, notes, ownership, outcome, or the exact
procedure version used.

The highest-value next step is to establish a trustworthy content contract
before adding more interaction. Staff should be able to tell whether a result
is current, complete, and actionable before relying on it during an incident.

## Current feature inventory

| Feature | Current behavior | Assessment |
| --- | --- | --- |
| OCC placement | Decision Matrix is the default module in the OCC Tools switcher and the route is visible only to `OCC.Admin`. | Implemented, but access is narrower than a read-only reference needs to be. Validate the intended role boundary. |
| Matrix list | Shows condition, criteria, required action, severity, tags, document type/code, document link, and last-reviewed date. | Implemented and useful for scanning. |
| Search | Searches condition, criteria, required action, tags, and document code. | Implemented; search scope is not explained and does not include every visible field such as review date. |
| Severity filter | Multi-select Stop, Restricting, and Clear filters. | Implemented. The meaning of “Clear” is ambiguous for an incident-response reference; confirm the domain term. |
| Document-type filter | Multi-select SOP and REF filters. | Implemented. |
| Tag filter | Multi-select tag chips; all selected tags must match. | Implemented, but AND behavior is implicit and there is no active-filter summary or clear-all action. |
| List view | Wide, action-oriented row layout. | Implemented; best current view for detailed review. |
| Grid view | Card layout for browsing. | Implemented; useful for discovery, less efficient for long operational text. |
| QRG view | Separate Trouble / Probable Cause / Remedy / Reference tables. | Implemented as a partial transcription of Sections 6–7 only. It is a different data shape from the matrix and is not visibly labeled as partial/incomplete. |
| External references | Matrix rows link to SharePoint URLs. QRG rows currently use `#`. | Matrix links are implemented; QRG references are placeholders and must not look actionable. |
| Freshness | Matrix rows show `lastReviewed`; footer shows a live browser clock. | Review dates are present, but there is no freshness policy, stale warning, effective date, owner, revision, or source-sync status. The live clock does not establish content freshness. |
| Data source | `MOCK_DATA` is bundled in the frontend. | Not production-connected. The data file contains a TODO for a future `/api/occ/decision-matrix` endpoint backed by SharePoint metadata. |
| Operational workflow | No acknowledgement, action checklist, notes, escalation, assignment, customer-communication handoff, resolution, or audit record. | Not implemented. |
| Governance | No version pinning, approval state, owner, effective date, revision history, or historical snapshot. | Not implemented. |

## UI and UX review

### Strengths

- The primary list puts the condition, criteria, required action, severity,
  and governing document in one scan path.
- Severity uses the console's existing status-pill convention and an accent
  border, so the module visually belongs to the staff console.
- Search, list/grid switching, and a QRG mode support different scanning
  patterns: lookup, browsing, and printed-guide style reference.
- The matrix shows the number of matching entries, which gives feedback after
  filtering.
- The module uses the shared theme tokens and existing small-button/table
  styles rather than introducing a separate visual language.

### Findings and recommended improvements

| Priority | Finding | Why it matters | Recommendation |
| --- | --- | --- | --- |
| P0 | The UI presents reference content as authoritative while data is local mock data. | Staff may act on content that is not synchronized with approved SOPs. | Add an explicit `Preview / local reference data` state now. Before production use, serve approved records from an API and show source, sync time, approval state, and content version. |
| P0 | QRG is only Sections 6–7, but the interface does not disclose that it is incomplete. | A controller can reasonably assume the QRG is the complete quick-reference guide. | Label it `QRG — partial transcription` and show coverage (`2 of N sections`, or `Sections 6–7 available`). Hide or disable placeholder references until real links exist. |
| P1 | QRG links use `href="#"`. | Clicking appears to open a reference but only moves the page; this damages trust during time-sensitive work. | Render an explicit `Reference unavailable` state, or omit the action and explain why. Add link status to the data model. |
| P1 | Clickable tag filters are `<div>` elements. | They are not keyboard reachable and have no semantic pressed state. | Use `<button type="button" aria-pressed={...}>` for tags. Add `aria-pressed` to severity/document filters and `aria-selected`/tab semantics to view switching. |
| P1 | Active filters are visually distributed across several rows with no summary or reset. | Users can lose track of why results disappeared. | Add an `Active filters` summary, per-filter removal, and `Clear all`; include the selected-tag AND behavior in helper text. |
| P1 | The page uses “Clear” as a severity value. | In an incident context, “clear” can mean resolved, low risk, or no action, which are different states. | Replace with a domain term such as `Routine / no escalation` if that is the intended meaning, or define the term beside the filter. |
| P1 | Search has no empty-query affordance, result highlighting, or keyboard shortcut. | Lookup is the core task, especially when the list grows. | Add a visible clear button, highlight matching text in results, support `/` to focus search, and preserve the query in the URL when practical. |
| P1 | Matrix rows do not expose a compact “what to do first” step sequence. | Long prose actions increase scanning time and make completion hard to verify. | Model immediate actions as ordered steps and show the first step prominently; keep the full procedure behind the reference link/details panel. |
| P1 | There is no stale-content treatment. | A `lastReviewed` date alone does not tell a controller whether the record is still valid. | Add effective date, next review date, owner, revision, and a visible `Needs review` state. Sort or filter stale procedures. |
| P2 | The live clock in the document footer adds visual noise but no operational value. | It can be mistaken for content currency or a record timestamp. | Remove it or replace it with `Last synced` / `Content effective as of` metadata. |
| P2 | List and grid duplicate the same content without an explicit use-case explanation. | Three view names add choice without telling staff when to use each. | Rename to task-oriented views such as `Scan`, `Browse`, and `QRG`, with a short tooltip or helper description. Consider making the list the only default until content volume justifies grid. |
| P2 | QRG tables are likely to overflow at narrow widths; there is no module-specific responsive treatment. | The console supports tablet use, but four text-heavy columns will become clipped or hard to read. | At tablet width, convert rows to stacked cards or allow intentional horizontal scrolling with a visible affordance; test at the existing 860px/760px breakpoints. |
| P2 | No loading, error, unavailable-source, or stale-sync states exist because the data is synchronous. | The future API will need clear failure behavior, and reference tools should fail closed. | Define states now: loading, source unavailable, partial data, stale data, and empty result. Never silently fall back to old content without labeling it. |
| P2 | The page does not connect an alert/risk context to a recommended procedure. | Staff must leave the monitoring workflow and search manually. | Add a deep link from Suggested Alerts and service-risk records that opens the relevant procedure with the triggering condition preserved. |
| P3 | Document links open a new tab without identifying document type or expected format beyond the code. | Context switching is costly and SharePoint access can fail. | Show `Open SOP` / `Open REF`, retain the code, and provide a copyable reference plus a clear access-error path. |

## Recommended product direction

Treat the feature as two related layers rather than one growing table:

1. **Reference layer:** searchable, versioned procedures and QRG entries.
   This is the immediate replacement for the current static module.
2. **Operational layer:** a procedure instance attached to a detected or
   manually created exception. It records acknowledgement, owner, completed
   steps, notes, escalation, customer communication, and resolution.

The operational layer should preserve the exact procedure revision shown to
the controller. This follows the existing proposal in
`plans/SUGGESTED_IMPROVEMENTS.md` and is necessary for training, audit, and
post-event review.

### Minimum content contract for an approved procedure

- Stable procedure ID and revision
- Condition/event type and searchable tags
- Observable criteria and exclusions
- Severity and plain-language meaning
- Immediate ordered actions
- Required notifications and escalation thresholds
- Customer-communication guidance
- Required documentation and resolution codes
- Owner, approver, effective date, next review date
- Source URL and source-system status

### Suggested delivery sequence

1. Correct trust signals: label local/preview data, disclose QRG coverage,
   remove fake QRG actions, add stale/source metadata, and fix keyboard
   semantics.
2. Create the API/content model and replace `MOCK_DATA` with approved records;
   add loading/error/partial/stale states and tests.
3. Add deep links from Suggested Alerts and service-risk records to a
   procedure.
4. Add procedure-instance workflow and audit history.
5. Add reporting on usage, unmatched events, skipped steps, escalations, and
   repeated manual work.

## Acceptance criteria for the next UI pass

- A user can identify whether content is approved, preview, stale, partial, or
  unavailable without opening another page.
- Every interactive filter is keyboard reachable and exposes its state to
  assistive technology.
- A user can clear all filters and understand the matching rule for combined
  filters.
- No action link navigates to `#` or otherwise pretends to open unavailable
  content.
- The QRG clearly communicates its coverage and behaves usefully at tablet
  width.
- The page has tested loading, API failure, empty, stale, and partial-content
  states.
- A procedure can be opened from an operational exception with its triggering
  context intact.
- Any recorded response stores the procedure revision that was shown.

## Evidence reviewed

- `frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx`
- `frontend/packages/onboard-console/src/routes/modules/decisionMatrix.data.ts`
- `frontend/packages/onboard-console/src/routes/modules/decisionMatrixQrg.data.ts`
- `frontend/packages/onboard-console/src/routes/modules/decisionMatrix.css`
- `frontend/packages/onboard-console/src/routes/OccTools.tsx`
- `frontend/packages/onboard-console/src/App.tsx`
- `CURRENT_STATE.md`
- `plans/SUGGESTED_IMPROVEMENTS.md`, section 13
