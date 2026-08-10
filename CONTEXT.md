# Domain Context

## Event

A real-world public-service occasion that may require special transit
operations. An event is not itself a route classification or a service plan.

## Route classification

The operational category assigned to a route, such as `SpecialEvent`,
`FixedRoute`, or `OnDemand`. A route classification describes what kind of
service a route represents; it does not by itself activate monitoring for a
particular occasion.

## Service plan

The operational configuration that places selected routes and geofences in
scope for a period of service. An active service plan enables crossing
detection and related notifications for its linked resources.

## Visible vehicle

A vehicle that satisfies the live-map visibility criteria and is returned by
the monitoring view. Visibility does not imply that the vehicle participates
in crossing detection or notifications.

## Event-participating vehicle

A vehicle operating on a route and within an active service plan's scope. This
is the relevant term for crossing detection and notifications, rather than for
live-map visibility alone.

## Monitoring eligibility

The conditions under which a vehicle is visible in the live monitoring view.
Route classification determines the route category; service-plan scope is a
separate condition used for crossing detection and notifications.

## Event operating context

The operational anchor for one public-service occasion. It owns the selected
operating scope, reusable map resources, direction rules, lifecycle, and
runtime monitoring relationship; it is not a route classification or a raw
feed record.

## Operational scope

The complete executable set for an Event: classified routes, geofences,
direction rules, local service dates, and conflict checks required before
activation.

## Active Service Plan

The approved and activated operational scope for an Event. Event AVL,
crossing detection, and notifications use this scope; draft, review, and
approved-but-not-active plans do not drive operations.

## Unplanned vehicle

A vehicle on a SpecialEvent-classified route that is not covered by an active
Service Plan. It belongs in a separate diagnostic/preview view and is not an
operational event participant.

## Plan revision

An immutable proposed replacement for an active Service Plan. A revision is
validated and reviewed before it replaces the active operational scope.

## Shared scope predicate

The single rule that determines operational participation: the vehicle route,
local service date, active Service Plan, and linked geofence must all match.
AVL projection, map display, crossing detection, and notifications must agree
on this predicate.

## Reusable resource

A geofence, location, or direction rule maintained independently of an Event
and linked into an Event's Service Plan when needed. Reuse does not make the
resource operational by itself.

## Operational conflict

An overlapping active scope that would make one route's live vehicle or one
crossing eligible for more than one Event at the same time. Conflicts are
rejected for routes; geofences may be reused when their linked plan scopes are
otherwise unambiguous.

## Assign to Event

A dispatch action that proposes an unplanned vehicle's route for an Event's
draft or plan revision. It changes proposed scope only; it never activates a
plan or bypasses review.

## Notification mode

The delivery behavior attached to a direction rule: manual review or automatic
send. It affects what happens after an eligible crossing and does not define
whether the crossing is in scope.

## Direction-rule precedence

The explicit priority that determines which matching direction rule is
authoritative when multiple rules cover the same geofence, transition, and
heading. The lowest priority wins; matching must be deterministic across
detection, notification, and audit.

Priorities are unique within a geofence and transition; equal-priority rules
are invalid rather than resolved by insertion order.

## Matched rule snapshot

The immutable rule meaning captured when a direction rule matches a crossing,
including its destination and notification mode. Later edits or deactivation
of the reusable rule do not rewrite the crossing's history or delivery
decision.

## Valid direction rule

A reusable direction rule that satisfies the transition, heading, destination,
priority, and notification-mode constraints required for operational use. An
invalid rule is rejected during authoring rather than stored for runtime code
to ignore.

## Event resource authoring

The maintenance of reusable geofences, locations, and direction rules. It is
separate from Event Planning and cannot create, approve, activate, or complete
an Event's Service Plan.

## Operating period

A bounded MVTA-local date range during which an Event has an executable Service
Plan. An Event may have sequential operating periods, but only one active scope
may govern a route at a time.

## Event lifecycle

The universal state progression for an Event's Service Plan: draft, review,
approved, active, suspended, and completed. Active-scope changes require a
validated plan revision.

## Unmatched crossing

An observed crossing within an active operational scope for which no linked
direction rule matches the vehicle heading. It is retained for audit and
diagnostics but does not create a notification.

## Classification change

A change to a route's operational category. A route in an active Service Plan
cannot be reclassified directly; the change must respect the plan lifecycle and
its reviewed scope.

## Route conflict

Two operating periods whose active or activatable route scopes overlap on the
same MVTA-local date. The conflict check is authoritative at activation and
revision application, not only in the user interface.

## Active-scope suspension

A deliberate pause of an Event's operational participation. AVL diagnostics may
continue to observe the route, but crossings and notifications stop until the
plan is resumed or completed.

## Event identity

The durable human-facing identity of an occasion: name, description, owning
team, and its sequence of operating periods. It remains stable even as plans
are revised or completed.

## Expired operational notification

An unsent notification made ineligible because its Event scope was suspended
or completed. Expiry preserves the record and reason; it must never send after
the scope ends.

## Event audit

The append-only explanation of Event configuration and runtime decisions,
including resource changes, lifecycle transitions, assignments, conflicts,
crossings, and notification outcomes.

## Generated Event

An Event created during migration to provide a durable parent for an existing
Service Plan. Its initial identity and operating period inherit only the
existing plan's known values.

## Event authority

The existing role system mapped onto Event capabilities: staff maintain
resources and propose scope, authorized publishers review and approve, and
operations/admin roles activate, suspend, or complete plans. Readers can view
the resulting audit without changing it.

## Runtime date

The Service Plan's MVTA-local operating-period date is authoritative for live
AVL, crossings, and notifications. Parent Event dates provide grouping context
but do not independently activate behavior.

## Archived Event

An Event with no active operational period that remains available for history,
audit, and reporting. Operational Events are completed or archived rather than
deleted.

## Resource version

The immutable form of a reusable geofence, location, or direction rule used by
a plan revision. Editing a resource must not silently rewrite the meaning of a
previously active operating period.

## Scope contract

The tested domain contract for operational participation, shared by AVL
projection, Event Monitoring, crossing detection, notifications, and
unplanned diagnostics. It evaluates route classification, active plan,
operating date, and linked resource scope together.

## Pinned resource

The exact immutable resource version captured by a plan revision. A pinned
resource keeps an operating period stable even when the reusable resource is
edited later.

## Activation validation

The atomic check that an Event operating period has a complete, conflict-free
graph of classified routes, pinned geofences, covered direction rules, and
valid MVTA-local dates before it can become active.

## Audit retention

Event configuration, lifecycle, crossing, and notification history retained for
operational accountability even after telemetry and diagnostic records age out.

## Detour and closure language

## Detour intake

A preliminary report of a possible closure or detour that has not yet been
reviewed by operations. It is separate from an authoritative Detour and may be
accepted, rejected, or marked duplicate.
_Avoid_: pending detour, draft detour

## Authoritative Detour

The reviewed operational record for a closure or reroute. It may be sourced
from Avail or managed manually when Avail cannot represent the operating need.
_Avoid_: intake, Avail detour

## Manual-only Detour

An authoritative Detour communicated through OnBoard messaging or other manual
operations channels because it is not represented in Avail.
_Avoid_: failed Avail detour, unofficial detour

## Avail build confirmation

The explicit operational confirmation that an intended Detour was successfully
created in Avail. Approval alone is not build confirmation.
_Avoid_: approved detour, presumed active

## Internal detour view

The authenticated staff-facing view of authoritative Detours, including manual
and Avail-sourced records. It is distinct from rider-facing publication through
Avail/GTFS.
_Avoid_: public detour page, rider detour feed

## Fulfillment mode

The operational path by which an authoritative Detour is carried out and
communicated: Avail-backed, fixed-route manual, or mobility manual.
_Avoid_: source, publication status

## Fixed-route manual Detour

A Detour affecting scheduled fixed-route service that is managed and
communicated manually because it is not represented in Avail.
_Avoid_: non-Avail detour

## Mobility manual Detour

A Detour affecting mobility/on-demand service that is managed and communicated
through the mobility operation's manual workflow.
_Avoid_: on-demand detour, Connect detour

## Conflict override

An explicit, reasoned authorization to proceed with a Detour despite an
overlapping active Detour at a stop or segment. The warning and reason are
retained in the operational audit.
_Avoid_: bypass, silent override

## Dissemination draft

A generated internal or contractor notification that has not yet been
explicitly reviewed and published by staff.
_Avoid_: sent notification, automatic alert

## Detour re-establishment

Creation of a new Detour identity from an existing Detour's configuration. The
original record remains unchanged and the new record enters the selected
workflow afresh.
_Avoid_: reopen, extend in place

## Temporal Detour status

The date-derived presentation status of an authoritative Detour, such as
Upcoming, Active, Recently Finished, or Expired. It is independent of the
workflow state and is never a substitute for operational approval.
_Avoid_: lifecycle state

## Workflow state

The operational progress of an authoritative Detour, including review,
Avail-build confirmation, rejection, duplication, and publication readiness.
_Avoid_: temporal status

## Likely duplicate

An intake whose route or location and operating window overlap an existing
record enough to require human review. A likely duplicate is not automatically
merged or rejected.
_Avoid_: duplicate match, auto-duplicate

## Avail last-seen record

The preserved OnBoard record of an Avail-backed Detour, including the latest
known feed observation. Its absence from one feed response does not delete or
automatically expire the record.
_Avoid_: stale detour, deleted feed row

## Attachment retention window

The period that Detour images and PDFs remain available after temporal expiry.
The agreed initial window is one year, after which the files and attachment
metadata are purged while the Detour audit remains.
_Avoid_: indefinite retention
