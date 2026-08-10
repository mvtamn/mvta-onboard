# Event Planning & Direction Rule Configuration

## Problem Statement

Direction Rule Configuration currently allows reusable rules to be authored
with weak request validation, implicit precedence, and inconsistent matching
between crossing detection and notification delivery. A rule edit can also
change the meaning of an active Service Plan without a reviewed revision, and
historical crossings do not reliably preserve the rule that produced them.

Administrators need a trustworthy resource-authoring workflow, while Event
Planning and runtime operations need deterministic, auditable behavior.

## Solution

Introduce one shared direction-rule policy boundary used by authoring,
crossing detection, and notification creation. It validates direction rules,
enforces unique priorities, selects the lowest-priority matching rule, and
creates an immutable matched rule snapshot for each matched crossing.

Reusable resource changes that affect an active Service Plan must flow through
a reviewed Service Plan revision. The editor must expose the same constraints
as the API, including editing and explicit priority management.

## User Stories

1. As an Event resource administrator, I want to create a direction rule for a geofence, so that crossings can infer an operational destination.
2. As an Event resource administrator, I want to select enter or exit, so that the rule applies only to the intended boundary transition.
3. As an Event resource administrator, I want to configure a heading range, so that the rule distinguishes vehicle travel direction.
4. As an Event resource administrator, I want wrapped heading ranges such as 350°–10°, so that northbound movement can be represented naturally.
5. As an Event resource administrator, I want to select a reusable destination location, so that the rule can refer to a mapped operational place.
6. As an Event resource administrator, I want to provide a bounded destination label, so that notifications remain useful and safe to store.
7. As an Event resource administrator, I want to choose manual review or automatic send, so that notification behavior is deliberate per rule.
8. As an Event resource administrator, I want invalid rules rejected with clear errors, so that unusable configuration never enters the operational catalog.
9. As an Event resource administrator, I want invalid transitions, modes, headings, priorities, labels, and destination references rejected, so that runtime code does not need to guess how to handle malformed data.
10. As an Event resource administrator, I want each geofence/transition priority to be unique, so that matching never depends on insertion order or UUID order.
11. As an Event resource administrator, I want overlapping heading ranges allowed when priorities differ, so that a broad fallback rule can coexist with a specific rule.
12. As an Event resource administrator, I want the lowest-priority matching rule selected, so that overlapping configuration is deterministic.
13. As an Event resource administrator, I want to see a rule's priority in the editor, so that I can understand and review precedence.
14. As an Event resource administrator, I want to edit an existing rule, so that correcting configuration does not require delete-and-recreate.
15. As an Event resource administrator, I want to reorder or assign rule priorities, so that I can intentionally control overlapping matches.
16. As an Event resource administrator, I want save failures surfaced as actionable messages, so that I know whether configuration was accepted.
17. As an Event planner, I want active Service Plans to keep their approved resource versions, so that an authoring change cannot silently alter live operations.
18. As an Event planner, I want changes affecting an active plan to require a reviewed plan revision, so that operational changes retain lifecycle approval.
19. As an Event planner, I want future plans to use updated reusable resources, so that resource maintenance remains efficient.
20. As an Event-participating vehicle operator, I want a crossing evaluated against one deterministic rule, so that the operational interpretation is consistent.
21. As an OCC operator, I want a crossing record to preserve the matched rule snapshot, so that later rule edits do not rewrite history.
22. As an OCC operator, I want the notification mode captured with the crossing, so that manual versus automatic delivery cannot change retroactively.
23. As an OCC operator, I want unmatched crossings retained without notifications, so that missing coverage remains auditable.
24. As an OCC operator, I want notification creation to use the same matched rule as crossing detection, so that labels and delivery modes cannot disagree.
25. As an auditor, I want historical crossings and notifications to remain explainable after resource edits, so that operational decisions can be reconstructed.
26. As an administrator, I want deactivated or nonexistent destination locations rejected for new rules, so that rules do not point at unavailable resources.
27. As an administrator, I want duplicate priorities rejected consistently by both the UI and API, so that direct API clients cannot bypass authoring safeguards.
28. As a developer, I want one policy boundary shared by authoring, detection, and notification, so that future rule behavior changes have one authoritative seam.

## Implementation Decisions

- Add a shared direction-rule policy boundary at the highest reusable domain seam.
- The policy validates transition, finite heading bounds from 0 through 360, bounded non-blank destination labels, valid notification modes, non-negative integer priorities, and valid destination references.
- Priorities are unique within a geofence and transition. Overlapping ranges are allowed only when priorities differ.
- Matching uses the lowest priority among rules matching the transition and heading. Any secondary ordering must not be observable because duplicate priorities are invalid.
- Crossing detection, notification creation, and audit-facing behavior use the same policy outcome.
- A matched rule snapshot captures the destination label, destination location identity where applicable, priority, and notification mode at crossing time. Later reusable-resource edits do not alter that snapshot.
- Notification creation must not re-query mutable rule configuration to determine the mode for an existing crossing.
- Active Service Plans use pinned resource versions. Changes to resources used by an active plan require a reviewed Service Plan revision; reusable-resource edits may affect future plans.
- The direction-rule API returns client errors for invalid input and resource-reference failures rather than exposing database constraint failures as server errors.
- The editor supports create, edit, delete, and priority changes, displays the effective precedence, trims user-entered labels, prevents duplicate submissions, and reloads after successful mutations.
- Existing lifecycle ownership remains unchanged: Event Resource Authoring maintains reusable resources, while Event Planning owns Service Plan lifecycle and revisions.
- Existing notification mode semantics remain unchanged: manual rules create reviewable notifications and automatic rules may send without manual approval.
- Schema changes may add priority/snapshot fields and constraints needed to enforce these decisions, while preserving existing crossing and notification audit history.

## Testing Decisions

- Tests must verify observable policy behavior, not helper implementation details.
- Add focused pure-module tests for valid and invalid rule requests, wrapped and non-wrapped headings, priority selection, duplicate-priority rejection, overlapping ranges, null headings, and unmatched crossings.
- Add tests proving the matched rule snapshot remains stable when the source rule is later edited or removed.
- Add tests proving notification creation uses the snapshot rather than current mutable rule configuration.
- Add API-level tests for clear 400 responses, invalid references, and successful create/update behavior where the existing REST test harness permits.
- Add frontend typecheck/build coverage for the editor’s create/edit/priority state transitions; browser verification should cover duplicate-submit prevention, error display, and reload behavior.
- Follow existing Node test conventions in the REST API, particularly the pure tests used for geofence, event scope, event processing, and validation behavior.

## Out of Scope

- Redesigning Event Service Plan lifecycle beyond the resource-revision boundary.
- Changing route classification or the shared operational scope predicate.
- Changing the meaning of manual versus automatic notification modes.
- Adding new map geometry types or changing Azure Maps authoring behavior.
- Automatically resolving conflicting active Service Plans or route conflicts.
- Reprocessing historical crossings after a rule edit.
- Replacing the existing notification transport or Teams delivery workflow.

## Further Notes

The existing domain glossary defines reusable resources, pinned resources,
matched rule snapshots, valid direction rules, and direction-rule precedence.
ADR 0004 records the active-plan resource-version boundary. The implementation
should preserve unmatched crossings for audit while ensuring they do not create
notifications.
