# Handoff — Decision Matrix read-experience prototype

**Written:** 2026-08-24
**Audience:** Agent creating a throwaway UI prototype before Decision Matrix implementation tickets
**Question:** Can a controller quickly find, understand, verify, and open governed Procedure guidance without the visual preview or document status obscuring the immediate response?

## Decision context

The app owns Procedure content and governance. SharePoint is document storage
only. A Procedure Revision is text-first: ordered Criteria and Immediate
Actions are the operational instruction. A SharePoint source document is a
secondary action, while an approved PNG/JPEG Document Rendition may appear as
helpful visual support in the reader.

The accepted vocabulary and boundary are in [`CONTEXT.md`](../../CONTEXT.md)
and [ADR-0024](../adr/0024-keep-decision-matrix-content-in-onboard.md). The
complete gap analysis and implementation plan is
[`decision-matrix-gap-analysis.md`](../decision-matrix-gap-analysis.md).

## Prototype scope

Create a **throwaway UI prototype**, close to
`frontend/packages/onboard-console/src/routes/modules/DecisionMatrix.tsx`.
Mark it prominently as a prototype. It must be runnable with one documented
project command, store no data, and use in-memory representative fixtures.

Build several genuinely different reader layouts on one route, switchable with
a URL search parameter and a floating bottom variant bar:

1. **Split detail** — Criteria/actions dominant on the left; document health,
   PNG/JPEG preview, and source document on the right.
2. **Action-first detail** — an immediate-action rail above/beside the
   criteria, with a collapsible visual/document panel.
3. **Progressive detail** — compact search result expands into an in-place
   detail view with a visual tab/panel only after text guidance is established.

Do not prototype Admin authoring, SharePoint/Graph calls, persistence, Office
or PDF embedding, or the later Procedure Instance workflow.

## Required states and fixtures

Each variant must render its full state and make it obvious when a controller
can or cannot rely on a document reference:

- An approved `Stop service` Procedure with Valid primary SOP, an approved PNG
  rendition, and QRG/Form support references.
- A `Restrict service` Procedure with a `Needs review` primary SOP caused by a
  revision mismatch; text guidance remains readable.
- A `Routine / no escalation` Procedure whose source document is Unavailable;
  show the secondary action only when access is plausibly available.
- An explainable recommendation list with at least two candidates and a
  controller-selected detail; no automatic procedure selection.
- Search/filter result, empty result, preview loading, preview unavailable,
  and narrow-screen layout.

Use the accepted Document Reference Health labels exactly: **Valid**, **Needs
review**, and **Unavailable**. Use a clearly labelled placeholder image if an
actual non-sensitive PNG fixture is unavailable; the preview must never become
the only presentation of a required action.

## Acceptance walkthrough

Test every variant at desktop and narrow widths, with keyboard-only navigation:

1. Start with an urgent condition and identify the first required action,
   severity meaning, owner, effective revision, and Document Reference Health.
2. Open an approved rendition, then the secondary **Open source document in
   SharePoint** action, without losing the structured guidance context.
3. Encounter `Needs review` and `Unavailable` references and identify the
   safe next action without interpreting either as a blank/loading state.
4. Open a source-qualified recommendation, understand its reason, and choose
   a Procedure without the prototype implying the choice was automatic.

Capture the verdict: which variant best preserves scan speed, hierarchy,
accessibility, and recovery from document failure. Commit the prototype to a
throwaway branch rather than the implementation branch; the implementation
issue should point to that branch and record the verdict.
