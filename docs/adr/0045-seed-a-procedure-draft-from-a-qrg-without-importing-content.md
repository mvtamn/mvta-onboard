# ADR 0045: Seed a Procedure Draft from a QRG without importing content

Status: accepted (2026-11-01)

## Context

MVTA's operational guidance already exists as Quick Reference Guides in
SharePoint: one-page summaries, usually a table or a flowchart, that staff
work from today. Authoring the same guidance a second time as a Procedure in
OnBoard's Decision Matrix means retyping every Criterion and every Immediate
Action from a page that already states them. Nothing had been authored on dev
as of 2026-11-01 - 0 Procedures - and the retyping is a plausible part of why.

ADR 0024 appears to forbid the obvious remedy. It says a Supporting Document
Reference "never imports or overwrites Decision Matrix content", and it
explicitly rejects "the previous SharePoint content-import model because two
authoritative stores would make a revision's Criteria and Immediate Actions
ambiguous". Read quickly, that rules out reading a QRG at all.

Read for what it protects, it does not. What ADR 0024 refuses is a second
authority: a SharePoint document that silently determines, or later changes,
what an approved Procedure Revision says. The ambiguity it names is about
*approved* content having two sources, not about where an author's first draft
came from.

OnBoard already has a precedent that threads this. The legacy Decision Matrix
migration (`decisionMatrixLegacyMigration.ts`) reads guidance from outside the
governed tables and still satisfies ADR 0024, because what it produces is a
Draft, and it refuses to produce even that unless the caller confirms every one
of seven fields was reviewed.

## Decision

An author may seed a Procedure Draft from a QRG in the Approved Document
Library. OnBoard reads the QRG through Graph, a model proposes Criteria and
Immediate Actions from it, and the author receives a **Draft**.

The seeding is bound by the same rules as a hand-typed Draft, because it goes
through the same code path (`createDecisionMatrixProcedureDraft`):

- Every proposed field is unreviewed. The Draft reaches Approved only through
  the existing review and approval, and approval still requires a currently
  Valid primary SOP or Reference.
- The QRG is a Supporting Document Reference on the Draft and never its
  Primary Supporting Document Reference - `supportingDocumentReferences.ts`
  refuses any type but SOP or Reference as primary. The author therefore names
  the governing SOP when they seed, rather than discovering at review that the
  Draft cannot be submitted.
- Proposed guidance is validated against the same vocabulary and the same
  column limits as typed guidance, declared once in
  `decisionMatrixGuidance.ts`.
- A QRG that OnBoard cannot read refuses the seeding. A model that cannot
  produce usable guidance does not: the author gets an empty Draft with the
  QRG attached, which is the manual path, and the reason is recorded.
- One QRG version seeds one Draft. A revised QRG - a new eTag - may seed
  again; the same unrevised QRG may not.

What the model proposed is kept verbatim (migration 158,
`DecisionMatrixQrgSeedings.proposed_json`) beside the Draft it seeded, with the
model that produced it.

The model is reached behind a `GuidanceProposer` seam. The adapter shipped
calls the Anthropic Messages API, reusing the `ANTHROPIC_API_KEY` already
configured on dev and prod for Compose's rider-summary action. An
Azure-OpenAI-in-tenant adapter is a second implementation of that seam, not a
rewrite, if MVTA decides operational documents must not leave the tenant.

## Consequences

- A Procedure's approved content still has exactly one authority: OnBoard. A
  QRG edited in SharePoint changes nothing about an approved Procedure
  Revision - it is Document Reference Health's business, as before.
- Reviewing a seeded Draft is real work, not a formality, and the console says
  whether it is showing proposed guidance or an empty Draft, and why.
- "What did the model propose, and what did the human change?" is answerable,
  which it would not be from the Draft or from `ProcedureAuditEvents` alone.
- Operational documents are sent to a model. That line was already crossed for
  internal incident reports; a QRG is a different class of document, and this
  records that it was a decision rather than a drift.
- Display widened to PDF (`isInlinePreviewMime`) so an author can read the QRG
  beside the Draft. What a Visual rendition may be is unchanged: PNG or JPEG.
- The feature is inert until a SharePoint administrator grants OnBoard read on
  the Approved Document Library under `Sites.Selected`. That grant had not been
  issued as of 2026-11-01 and is the same one the SOP folder walk waits on.
