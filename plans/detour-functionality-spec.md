# Detour Functionality Expansion Specification

## Problem Statement

MVTA staff receive closure and detour information from contractors, police or
city notices, field reports, phone calls, Avail, email, and an Excel tracker.
The existing Detour module centralizes reviewed records, but it does not yet
provide a controlled intake and operational workflow for deciding what a
report means, reconciling Avail build outcomes, identifying conflicts, or
preparing notifications. This leaves unreviewed reports, Avail build failures,
manual-only closures, and dissemination work vulnerable to being missed or
duplicated.

## Solution

Add a complete internal workflow around the existing Detour module. A separate
Detour intake stage captures preliminary reports. An OCC reviewer accepts,
rejects, or marks them duplicate, then manages the resulting authoritative
Detour through one workflow with three fulfillment modes: Avail-backed,
fixed-route manual, or mobility manual.

The system will preserve the distinction between workflow state and
date-derived temporal status, warn about overlapping detours while requiring a
reasoned override, preserve Avail records that disappear from a feed, and
generate reviewed-but-unsent dissemination drafts. Mapping, attachments, and
migration support the workflow without creating a second public rider-facing
publication path.

## User Stories

1. As an intake staff member, I want to record a preliminary detour report, so that operational information has a durable home before review.
2. As an intake staff member, I want to record how the report was detected, so that operations can trace its origin.
3. As an intake staff member, I want to record the affected location, so that reviewers can understand the closure before choosing a fulfillment mode.
4. As an intake staff member, I want to record impacted stops and routes, so that the report can be compared with existing detours.
5. As an intake staff member, I want to record a proposed operating window, so that time conflicts can be identified early.
6. As an intake staff member, I want to attach supporting images or PDFs, so that reviewers can see signs, maps, notices, or other evidence.
7. As an OCC reviewer, I want a queue of pending intake reports, so that I can find unreviewed operational work.
8. As an OCC reviewer, I want to accept an intake report as an authoritative Detour, so that approved operational records are separated from preliminary reports.
9. As an OCC reviewer, I want to reject an intake report with a reason, so that the decision is explainable.
10. As an OCC reviewer, I want to mark an intake report as a duplicate, so that duplicate reports do not become separate operational records.
11. As an OCC reviewer, I want to see likely duplicates based on route or location and overlapping time windows, so that I can make an informed decision.
12. As an OCC reviewer, I want likely-duplicate detection to warn rather than automatically merge records, so that legitimate overlapping exceptions remain possible.
13. As an OCC reviewer, I want to choose Avail-backed fulfillment, so that a detour intended for Avail has an explicit operational path.
14. As a fixed-route operator, I want to choose fixed-route manual fulfillment, so that closures Avail cannot represent can still be managed.
15. As a mobility operator, I want to choose mobility manual fulfillment, so that MVTA Connect/on-demand closures use an appropriate workflow.
16. As an OCC reviewer, I want approval and Avail-build confirmation to be distinct, so that a detour is not treated as Avail-built merely because it was approved.
17. As an OCC reviewer, I want to mark an Avail-backed Detour as pending Avail build, so that unfinished operational work is visible.
18. As an OCC reviewer, I want to confirm that an Avail build succeeded, so that the Detour can become eligible for activation and dissemination.
19. As an OCC reviewer, I want to record an Avail build failure, so that unresolved conflicts or build problems do not disappear into limbo.
20. As an OCC reviewer, I want to retry or revise a failed Avail-backed Detour, so that an operational problem can return to the build workflow.
21. As an OCC reviewer, I want manual fulfillment modes to bypass Avail-specific states, so that manual-only closures are not blocked by an unavailable Avail representation.
22. As an OCC reviewer, I want to see workflow state separately from temporal status, so that a future detour that is approved is not confused with one that is active today.
23. As an operations user, I want temporal status to be computed from the operating dates, so that status remains consistent across list, detail, search, and reporting views.
24. As an operations user, I want to see upcoming, active, recently finished, monitor, and expired Detours, so that I can manage current work and history.
25. As an OCC reviewer, I want conflicts at stops or segments to produce a warning, so that I can resolve or consciously accept operational overlap.
26. As an OCC reviewer, I want to override a conflict only with a reason, so that exceptions are accountable.
27. As an auditor, I want conflict warnings and overrides retained, so that later reviewers can understand why overlapping Detours were allowed.
28. As an OCC reviewer, I want the approving agent to own the Avail handoff, so that every pending build has a responsible person.
29. As an operations user, I want stale pending Avail builds surfaced after a configurable threshold, so that interrupted handoffs are noticed.
30. As an operations user, I want an Avail-backed record preserved when it disappears from a feed response, so that a transient or incomplete feed cannot delete operational history.
31. As an operations user, I want the latest Avail observation retained, so that I can investigate whether a missing record is stale or genuinely ended.
32. As an operations user, I want messages generated as dissemination drafts, so that staff can review wording before anything is sent.
33. As an operations user, I want internal and contractor recipient lists kept separate, so that the same draft can be routed appropriately without hiding delivery intent.
34. As an authorized publisher, I want to explicitly publish a dissemination draft, so that notifications are never sent solely because a Detour was entered.
35. As an operations user, I want to draw an affected path on a map, so that intake does not depend on manually describing every segment.
36. As an operations user, I want nearby GTFS stops identified from the drawn path, so that impacted-stop entry is faster and more consistent.
37. As an operations user, I want mapping to use GTFS static data for fixed-route service, so that route and stop context comes from MVTA's fixed-route source of truth.
38. As an operations user, I want mobility records to remain usable without fixed-route GTFS geometry, so that the mobility workflow is not forced into the wrong data model.
39. As an authorized user, I want private image and PDF storage with authenticated short-lived reads, so that operational attachments are not publicly exposed.
40. As an authorized user, I want attachments retained for one year after temporal expiry, so that dispute, compliance, and operational review remain possible.
41. As an authorized user, I want expired attachments purged after the one-year retention window, so that sensitive material does not accumulate indefinitely.
42. As an auditor, I want the Detour audit record retained after attachment purge, so that the operational decision history remains available.
43. As an OCC user, I want to clone an existing Detour into a new identity, so that recurring or split closures can be entered efficiently.
44. As an OCC user, I want clone/re-establish to clear sent flags and restart workflow, so that the new Detour cannot inherit false publication history.
45. As an OCC user, I want the original Detour unchanged after re-establishment, so that historical records remain accurate.
46. As a migration operator, I want spreadsheet-only records imported as authoritative manual Detours, so that existing operational history is centralized without inventing intake events.
47. As an OCC.Detour user, I want to create, edit, and attach files to Detours, so that day-to-day maintenance does not require publisher or administrator access.
48. As a read-only staff user, I want to view authoritative Detours and their history, so that operational context is available without granting edit rights.
49. As an operations administrator, I want existing soft-delete and audit conventions preserved, so that records are recoverable and historical reporting remains trustworthy.
50. As a rider, I want the existing Avail/GTFS publication path to remain authoritative, so that the internal workflow does not create conflicting public detour surfaces.

## Implementation Decisions

- Keep preliminary Detour intake in a separate persistence model from authoritative Detours.
- Use a single authoritative Detour workflow with a separate fulfillment mode: `avail`, `fixed_route_manual`, or `mobility_manual`.
- Keep workflow state separate from computed temporal status. Temporal status remains derived from dates and is not stored as an independent truth.
- Use these workflow concepts: pending review, approved, pending Avail build, built in Avail, active, expired, rejected, duplicate, and Avail build failed. Manual modes bypass Avail-only states.
- Preserve the existing authoritative Detour model, segments, reporting fields, reference numbering, soft deletion, reason codes, and Avail synchronization behavior where they remain compatible.
- Add intake fields for detection source, description, location, impacted stops, proposed operating window, attachments, reviewer decision, and decision audit data.
- Add fulfillment-mode, workflow-state, ownership, build-confirmation, stale-handoff, conflict, override-reason, and dissemination-draft data as needed to the authoritative workflow.
- Likely duplicates are detected from overlapping location/stop or route scope and overlapping operating windows. Detection warns a reviewer; it does not merge or reject automatically.
- Conflict checks occur when an intake is accepted/applied and when Avail data is ingested. Conflicts warn and require an override reason rather than silently allowing overlap or hard-blocking all exceptions.
- Avail-backed records retain last-seen feed information. A missing feed row does not delete or automatically expire a Detour.
- The approving OCC user owns the Avail handoff. A stale pending-build threshold surfaces reminders or dashboard warnings.
- Notification generation creates separate internal and contractor drafts. Explicit staff publication is required before sending.
- Mapping is limited to line drawing and nearby-stop detection for v1. Fixed-route geometry and stops come from GTFS static data; mobility remains a separate manual fulfillment path.
- Attachments initially support images and PDFs only. Storage is private, reads use short-lived authenticated URLs, and both attachment metadata and blobs are purged one year after temporal expiry while the Detour audit remains.
- Clone/re-establish creates a new Detour identity, clears sent and approval history, preserves the source record, and restarts the selected workflow.
- Spreadsheet migration creates authoritative manual Detours and preserves available historical fields and tracker flags.
- Reuse the existing Detour API, authorization, validation, status, search/reporting, image, Avail-sync, and frontend module seams rather than introducing a parallel Detour subsystem.
- The public rider-facing surface remains Avail/GTFS. This feature is an internal operational workflow.

## Testing Decisions

- Test externally observable behavior at the REST/API boundary wherever possible, with focused pure-function tests only where deterministic domain rules are the highest seam.
- Test intake creation, review decisions, promotion to authoritative Detour, rejection, duplicate marking, and audit output through the API.
- Test each fulfillment mode and ensure manual modes do not require Avail-specific transitions.
- Test workflow-state transitions independently from date-derived temporal status, including boundary dates, open-ended windows, monitor-only records, and expired records.
- Test duplicate warnings, conflict warnings, required override reasons, and audit retention.
- Test Avail upsert, last-seen updates, missing-feed preservation, manual-row protection, stale pending-build detection, and build-failure recovery.
- Test dissemination draft generation, separate recipient lists, explicit publication, and prevention of sends before publication.
- Test attachment type/size validation, private upload/read authorization, one-year retention eligibility, purge behavior, and audit preservation.
- Test clone/re-establish identity, cleared sent flags, new workflow state, and unchanged source record.
- Test spreadsheet migration mapping and preservation of historical values.
- Test role boundaries for read-only staff, `OCC.Detour`, publishers, and administrators.
- Follow existing prior art: detour validation tests, computed-status tests, Avail feed tests, image validation tests, authorization tests, and existing frontend detour/report workflows. Tests should assert API responses and resulting behavior, not SQL statement shape, React state variables, or private helper implementation.

## Out of Scope

- A second public rider-facing detour page or replacement for Avail/GTFS publication.
- Full turn-by-turn routing or route optimization.
- Automatic publication or automatic sending of rider, internal, or contractor notifications.
- Automatic duplicate merging.
- Hard-blocking every overlapping detour.
- Automatic deletion or expiry when Avail omits a record from one response.
- Treating every Detour as Avail-backed.
- New role creation for intake in v1.
- Using the Detour Stops feed as the source for rider-directed replacement-stop semantics.
- Broad arbitrary-document attachment support beyond images and PDFs.
- Retaining attachments indefinitely.
- Replacing the existing Detour Reports, numbering, reason-code, or soft-delete capabilities.

## Further Notes

- The current repository already contains the manual Detour module, Avail sync, image endpoints/UI, reports, numbering, and role model. The implementation should extend and reconcile those seams rather than rebuild them.
- The domain glossary and ADR for this decision are maintained in the repository's context and ADR documents.
- Avail production integration details, credentials, and live feed behavior remain deployment/runtime concerns; the workflow must degrade safely when the feed is unavailable.
- The one-year attachment retention period is the current policy decision and should be configurable without changing the domain meaning of expiry.
