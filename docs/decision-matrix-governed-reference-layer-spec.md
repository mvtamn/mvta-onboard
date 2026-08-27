## Problem Statement

Controllers need governed Procedure guidance during an operational condition,
but the current Decision Matrix is an incomplete transition between a local
reference UI and a SharePoint content-import design. It cannot author
app-owned Procedure Revisions, reliably validate supporting documents, preserve
an immutable governance trail, or present document health and visual support
without obscuring the immediate response. Its existing SharePoint import would
also make Criteria and Immediate Actions ambiguous by treating a document
storage system as a second content authority.

## Solution

Make OnBoard the authority for the Decision Matrix reference layer. It will
own Procedures, immutable Procedure Revisions, Criteria, Immediate Actions,
Procedure Match Rules, governance, and Procedure Audit Events. SharePoint will
store only Supporting Document References and optional approved Document
Renditions. An Admin authoring workspace will manage the lifecycle and a
controller-facing Matrix will remain text-first, provide an explainable
recommendation, and offer a PNG/JPEG visual preview with the full source
document as a secondary action.

This follows ADR-0024: keep Decision Matrix content in OnBoard and use
SharePoint only as supporting-document storage.

## User Stories

1. As an OCC Viewer, I want to search approved Procedures by condition, Criteria, Immediate Actions, tags, document identifiers, and source-document file name, so that I can find guidance under time pressure.
2. As an OCC Viewer, I want search and filter state preserved in the URL, so that I can return to or share the exact Matrix view.
3. As an OCC Viewer, I want a Procedure detail to place text-based Criteria and Immediate Actions ahead of visual material, so that I can act even when a document is inaccessible.
4. As an OCC Viewer, I want to see the current approved Procedure Revision, severity meaning, Procedure Owner, effective date, next Procedure Review Date, and Document Reference Health, so that I know whether guidance is trustworthy.
5. As an OCC Viewer, I want a Valid primary SOP or Reference available through a clearly labelled secondary SharePoint action, so that I can consult the full approved source when needed.
6. As an OCC Viewer, I want an approved PNG/JPEG Document Rendition displayed inside the Matrix when one exists, so that I can orient myself without leaving the controller workspace.
7. As an OCC Viewer, I want a clear fallback when a preview, PDF, Office document, or source document cannot be displayed in the app, so that I never mistake a failure for missing guidance.
8. As an OCC Viewer, I want Valid, Needs review, and Unavailable Document Reference Health explained in plain language with a last-checked time, so that I can choose a safe next action.
9. As an OCC Viewer, I want an emergency-withdrawn Procedure link to explain that the guidance must not be used and identify a replacement when one exists, so that an old bookmark does not become a dead end.
10. As an OCC Publisher, I want the same read-only approved Procedure experience as a Viewer, so that publishing authority does not imply Procedure-governance authority.
11. As an OCC Admin, I want to create an app-owned Draft Procedure Revision, so that I do not have to author Criteria or Immediate Actions in SharePoint.
12. As an OCC Admin, I want to record ordered applies/excludes Criteria with stable identity, so that a Procedure's applicability is explicit and survives revision.
13. As an OCC Admin, I want to record ordered required, conditional, and informational Immediate Actions with stable identity, so that later Procedure Instances can reliably capture outcomes.
14. As an OCC Admin, I want each Draft to identify a Procedure Owner team and optional individual contact, so that correctness and review are accountable through staff changes.
15. As an OCC Admin, I want to attach one required primary SOP or Reference and optional ordered References, Forms, Maps, QRGs, and Visual Renditions, so that controllers have one unambiguous governing source plus useful support material.
16. As an OCC Admin, I want Document References to use stable SharePoint identity and expected version metadata, so that renamed links and source-document changes are detected safely.
17. As an OCC Admin, I want to move a complete Draft into Under review and return it to Draft with a reason, so that incomplete guidance cannot be accidentally approved.
18. As an OCC Admin, I want to approve a complete Under review revision immediately, so that one current Procedure Revision is effective without a separate scheduling state.
19. As an OCC Admin, I want approval of a replacement to supersede the prior effective revision, so that controllers never receive two competing current procedures.
20. As an OCC Admin, I want to clone a historical revision into a new Draft rather than edit or reactivate it, so that past guidance and document references remain defensible.
21. As an OCC Admin, I want ordinary retirement to require an approved replacement and emergency withdrawal to require prominent confirmation and a reason, so that guidance is not accidentally removed but dangerous guidance can be stopped.
22. As an OCC Admin, I want stale concurrent saves rejected with a useful refresh/diff prompt, so that one Admin cannot silently overwrite another's Draft work.
23. As an OCC Admin, I want a Procedure Audit Event for each saved Draft change, lifecycle decision, Document Reference change, and health check, so that governance history is reconstructable without recording keystrokes.
24. As an OCC Admin, I want a governance queue for overdue Procedure Review Dates and unhealthy Document References, so that review work is visible without relying on initial email or Teams notifications.
25. As an OCC Admin, I want checks before review, at approval, daily, and on demand, so that a required Document Reference is valid when published and later problems are surfaced.
26. As an OCC Admin, I want document checks to update only Document Reference Health, so that a SharePoint change cannot silently alter Criteria, Immediate Actions, or lifecycle state.
27. As an OCC Admin, I want source-qualified Procedure Match Rules with priority and an explanation, so that recommendations from Service Risk and Suggested Alerts are governed rather than text guesses.
28. As a controller, I want to choose among explainable Procedure Recommendations, so that the Matrix does not automatically select or record guidance before a later Procedure Instance workflow exists.
29. As a migration administrator, I want legacy Matrix rows preserved as read-only candidates and converted one at a time into reviewed app-owned Drafts, so that the cutover does not silently bless imported content.
30. As a security-conscious controller, I want document previews fetched through authorized app behavior that preserves my SharePoint entitlement, so that the app does not broaden access or expose Graph credentials.
31. As a keyboard and screen-reader user, I want the Matrix detail, recommendation, health explanation, preview, and source-document action to be reachable and announced in logical order, so that the operational tool remains usable under stress.
32. As a controller on a narrow display, I want the text guidance to remain readable before visual material stacks beneath it, so that responsiveness does not hide immediate actions.

## Implementation Decisions

- The reference layer is app-owned. A Procedure has a durable immutable identity and condition key; a materially different condition is a new Procedure rather than a repurposed key.
- Procedure Revisions use the accepted lifecycle: Draft, Under review, Approved, Superseded, and Retired. Approval is immediately effective, only one revision is effective, and Superseded/Retired revisions are terminal sources for new Drafts only.
- `OCC.Admin` is the sole author, reviewer, approver, withdrawal/retirement authority, Document Reference checker, and audit reader for this release. Viewer and Publisher roles read current approved guidance only. Admin self-approval is allowed with durable audit evidence.
- The server enforces the publication gate: procedure identity, severity and meaning, Procedure Owner, effective and next-review dates, at least one Criterion, at least one Immediate Action, and one currently Valid primary SOP/Reference.
- Criteria are ordered applies/excludes statements; Immediate Actions are ordered required/conditional/informational instructions. They are app data, not parsed or synchronized from document prose.
- Every revision owns frozen Supporting Document References. A primary SOP/Reference is required; optional ordered labels are SOP, Reference, Form, Map, QRG, and Visual rendition. Document changes create a new revision.
- A Document Reference stores stable SharePoint site, drive, and item identity plus expected version, name, and MIME metadata. Valid, Needs review, and Unavailable are health states, separate from Procedure Revision lifecycle.
- The initial document integration uses delegated/on-behalf-of access. A same-origin authorized preview endpoint streams only approved image types; it must not expose app credentials, durable Graph download URLs, or arbitrary browser-provided external URLs.
- An approved PNG/JPEG Document Rendition is optional visual support. The full SharePoint source is a secondary action. Office/PDF embedding and document conversion are excluded until a tenant-backed spike validates them.
- Document checks happen before review, at approval, daily, and on demand. A failed required check blocks approval. A later failed check leaves text guidance visible with health warnings and never silently retires or modifies the revision.
- The existing SharePoint structured-content import endpoint and timer are disabled before app authoring launches. Existing rows remain read-only migration candidates; no generic bulk content-import feature remains.
- Procedure Match Rules are Admin-maintained, source-qualified, prioritized, and explanatory. They may recommend multiple Procedures but cannot auto-select or persist one.
- Controller reading remains in OCC Tools; Admin authoring, health checks, audit, migration, and match-rule management live in a separate administration workspace. The read detail is text-first, provides accessible fallbacks, and stacks visual support after text at narrow widths.
- The agreed read-experience prototype must validate the reader layout before implementation tickets commit the production UI.

## Testing Decisions

- The primary feature seam is the authenticated Decision Matrix REST API. Contract tests exercise reader access, Admin lifecycle transitions, publication validation, concurrency rejection, Document Reference health, recommendations, preview authorization, and migration behavior against a test database.
- Tests assert externally visible behavior and persisted governance outcomes, not component state, SQL query shape, or internal helper calls.
- The console route is tested through user interactions against the API contract: search/filter URL state, detail hierarchy, recommendation explanation, health/failure states, source-document action, keyboard order, screen-reader labels, and narrow-width behavior.
- A fake Graph/document adapter covers Valid, revision mismatch, missing, forbidden, network failure, stale check, and image MIME rejection without requiring SharePoint connectivity in the automated suite.
- Lifecycle coverage includes every allowed and forbidden transition, one-effective-revision behavior, emergency withdrawal, clone-only restoration, mandatory reasons, immutable approved content, and Admin-only governance authorization.
- Migration coverage preserves legacy identity/history, rejects malformed Criteria/actions/references, and proves the legacy import cannot modify structured app-owned content after cutover.
- Existing Decision Matrix UI tests provide the initial route-test precedent; existing authenticated Functions handlers provide the HTTP authorization precedent. New tests should extend these behavior-level seams rather than assert implementation detail.

## Out of Scope

- Procedure Instances, acknowledgement, action completion/skips, assignment, escalation, customer-communication handoff, resolution, and reporting.
- Automated email or Teams notifications for governance queues.
- Office, PDF, Excel, or PowerPoint in-app embedding; document conversion; and a guarantee that Graph thumbnails are controlled previews.
- A generic SharePoint content-import or bulk procedure-import feature.
- Future-effective/scheduled Procedure Revisions.
- A separate author/reviewer/approver role model or two-person approval policy.
- Changing underlying SharePoint document access policy or records-retention policy.

## Further Notes

- The next implementation action is the UI prototype described in the Decision Matrix read-experience prototype handoff. It must test split-detail, action-first, and progressive-detail variants at desktop and narrow widths before tickets are decomposed.
- Before implementation, Operations must provide the approved SharePoint site/library and migration inventory. The target environment must validate delegated/on-behalf-of access without exposing app credentials to the browser.
- The authoritative vocabulary is in `CONTEXT.md`; the architecture boundary is ADR-0024; the detailed evidence and phased plan are in the Decision Matrix gap analysis.
