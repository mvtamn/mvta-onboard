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
