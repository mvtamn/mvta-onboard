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

## Approved Service Plan

A reviewed Service Plan whose operational scope is complete and valid for
activation: it has the required route, active geofence, direction rule, valid
dates, and conflict checks. It may be previewed, but it does not drive live
operations until activated.

An Approved Service Plan is frozen; corrections are made through a draft or
reviewed revision rather than by mutating the approved record.

## Unassigned vehicle

A visible vehicle that is not currently assigned to the selected active
Service Plan. It remains visible in Event AVL, but it is not an operational
event participant for that plan and does not trigger its geofence alerts.

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

## Canonical transit location

The single active reusable location record representing a named transit,
garage, venue, or staff checkpoint. Duplicate records for the same location
are merged or retired rather than presented as separate operational choices.

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

Every planned resource add or removal records the Event, operating period,
resource identity and type, actor, timestamp, and plan or revision context.

## Generated Event

An Event created during migration to provide a durable parent for an existing
Service Plan. Its initial identity and operating period inherit only the
existing plan's known values.

## Event authority

The existing role system mapped onto Event capabilities: staff maintain
resources and propose scope, authorized publishers review and approve, and
operations/admin roles activate, suspend, or complete plans. Readers can view
the resulting audit without changing it.

## Event Planning workflow

The operator-facing workflow that creates an Event, defines its operating
period, assembles and validates a Service Plan, submits it for review, and
activates or changes its operational scope. Event Planning owns the workflow;
it does not replace reusable resource authoring.

## Operational observation

An observed runtime fact, such as a vehicle entering or leaving a geofence.
An observation is retained for monitoring and audit before any notification or
other operational action is selected.

## Operational rule

A configured decision applied to an operational observation. It determines
whether the observation requires no action, manual review, automatic delivery,
or another supported operational response. A rule is not the observation and
does not determine whether the underlying vehicle is in operational scope.

## Operational proximity alert

An operational notification caused by a vehicle entering a configured
geofence around a transit location, venue, garage, or checkpoint. The
geofence defines “near”; the alert is associated with the Event, operating
period, vehicle, and matched direction rule.

Entry and exit are independent transitions and may have different rules,
destinations, messages, and delivery modes.

## Resource authoring boundary

Reusable geofences, locations, and direction rules are maintained in the
administrative authoring surface. Event Planning selects, previews, and links
those resources into a Service Plan, with a path to author a missing resource,
but does not duplicate the reusable-resource editor.

## Event AVL operating context

The selected Event and its selected operating period that define the scope for
an operator's live map, vehicle list, crossings, notifications, and operational
actions. Event AVL may provide a cross-event summary, but an operational action
must identify one Event operating context.

Event AVL may aggregate all active operating periods for the selected Event in
one operational view. Geofence movement, crossings, and notifications are the
primary workflow; vehicle positions provide supporting live context. Every
crossing, notification, and action still identifies its operating period.

If the published scope is missing or invalid, Event AVL fails closed and shows
a data-health error; it never falls back to mutable planning links or draws
unverified operational resources.

## Reviewed scope change

A change to an active Event operating period that is proposed as a plan
revision, reviewed, and explicitly applied. Direct mutation of active scope is
not allowed.

## Operational action

The result selected by an operational rule after an observation is evaluated.
The initial action vocabulary is no action, manual review, or automatic Teams
delivery. An operational action is distinct from the observation and from the
reusable rule that selected it.

Routine proximity alerts may use automatic Teams delivery; exceptional
customer-impacting actions may require manual review.

## Teams notification destination

The configured Teams channel or operational group that receives a matched
operational notification. It is selected through resource or direction-rule
configuration and is not hardcoded in Event AVL.

## Notification cooldown

The per-rule interval during which repeated observations for the same vehicle,
geofence, transition, and operating period do not create another delivered
notification. An Event-level default supplies the value when a rule does not
override it.

## Sequential operating period

One bounded Service Plan under an Event. An Event may have multiple sequential
periods for different days or phases, while only one period can govern a route
at a time.

## Event operating scope snapshot

The immutable routes, classifications, geofences, locations, direction rules,
and operational actions captured when a Service Plan or reviewed revision is
activated. Reusable resource edits do not alter an existing snapshot.

Activation is atomic: an invalid scope is not partially published.

## Planned scope preview

The read-only view of an approved but not active Service Plan's resources. It
can show planned geofences and locations for review, but it has no live
vehicles, crossings, notifications, or operational actions.

## Operating-period repair

A correction to an incomplete or incorrect non-active Service Plan made by
creating or editing a draft or reviewed revision and taking it through the
normal approval and activation workflow. Approved or active scope is not
repaired by direct mutation.

The operator may invoke this as “modify plan,” but the approved plan remains
unchanged while its draft repair is prepared.

## Proposed vehicle assignment

An operator's proposal to add an out-of-scope SpecialEvent vehicle or route to
a draft Service Plan or active-plan revision. It requires the normal review
and activation path and never changes live scope immediately.

## Notification lifecycle

The auditable progression of an operational notification from pending review
through acknowledgement and successful delivery, or to dismissed, failed, or
expired. Delivery success is the only condition that makes a notification
sent.

Repeated observations for the same vehicle, geofence, transition, and
operating period may be retained in audit while notification delivery is
deduplicated within the configured cooldown window.

Automatic delivery does not close the operational case. Staff may acknowledge
or escalate the notification, but acknowledgement does not prove that the
vehicle arrived safely.

## Operational notification message

The factual payload sent to a Teams destination: Event, operating period,
vehicle, route, heading, geofence or location, transition, observation time,
and matched rule or destination. It does not include an ETA unless a reliable
ETA source is available.

## Event AVL layer

A separately toggleable operational view associated with one Event operating
context, optionally aggregating its active operating periods, such as
active-plan vehicles, diagnostic vehicles, geofences, locations, route
overlays, crossings, or notification state.

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

## Service Operations language

## Service Operations

The staff-facing operational area that groups service-alert communications and
service-risk monitoring. It includes the shared overview, Compose, Suggested
Alerts, Active Service Alerts, and Service Risk & Quality workflows; restricted
specialist areas remain separate and role-gated.
_Avoid_: OCC Tools, operations dashboard

## Service Alert

A customer-facing communication about a current or expected transit service
condition. A Service Alert may be suggested, active, or expired; its delivery
channels describe how it is distributed.
_Avoid_: message, notification, automatic alert

## Suggested Alert

A detected or drafted Service Alert that requires authorized staff review before
it can become an Active Service Alert.
_Avoid_: automatic alert, published alert

## Active Service Alert

An approved Service Alert currently eligible for display or delivery through its
configured rider-facing channels.
_Avoid_: active message, sent notification

## Delivery channel

A configured destination or audience for a Service Alert, such as the website,
SMS, email, mobile app, or an internal Teams audience. A selected channel does
not by itself prove that delivery occurred.
_Avoid_: notification, target system

## Service Risk & Quality

The combined monitoring workflow for fixed-route departure risk and on-demand
customer wait quality. Fixed Route and On-Demand are service-type views within
the workflow, not separate primary navigation areas.
_Avoid_: Live Delays, Fixed Route Risk module, On-Demand Quality module

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

The operational progress of an authoritative Detour, such as approval,
fulfillment readiness or confirmation, fulfillment failure, and closure. It is
separate from temporal status, fulfillment mode, and communication eligibility.
Intake decisions such as rejection and duplication belong to Detour intake, not
to the authoritative Detour workflow.
_Avoid_: temporal status, communication readiness

## Detour communication eligibility

A derived determination that an authoritative Detour has reviewed operational
facts, an accountable reviewer, and the fulfillment prerequisites needed for a
specific audience's communication. It is not a lifecycle state and does not
publish anything by itself.
_Avoid_: active state, published state, automatic notification

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

## Contractor performance assessment language

**Agreement**:
The governing contractual term under which one Contractor's performance is assessed. One Agreement has exactly one Contractor throughout its term.
_Avoid_: account, multi-contractor program

**Assessment Contractor**:
The sole Contractor subject to a particular Agreement and its performance assessments.
_Avoid_: active contractor, selected contractor

**Assessment Period**:
A calendar month of service, determined in the `America/Chicago` timezone, for which the Assessment Contractor's performance is evaluated.
_Avoid_: contractor-month, reporting month

**Assessment Rule Set**:
The immutable collection of performance standards and tiers governing one Assessment Period. Amendments normally govern a later Assessment Period unless the Agreement expressly makes them retroactive.
_Avoid_: current standards, live tiers

**Assessment Reviewer**:
A person authorized to confirm evidence and recommend confirmation, adjustment, or waiver of a proposed assessment.
_Avoid_: Issuing Authority, investigator

**Issuing Authority**:
The Contract Manager or formally delegated authority who may finalize and issue an assessment.
_Avoid_: reviewer, administrator

**Validation Draft**:
An immutable, non-binding assessment artifact shared to identify data errors before final issuance. It creates no dispute deadline.
_Avoid_: preliminary issuance, preliminary penalty

**Shared Validation Draft**:
A Validation Draft whose sharing has been explicitly recorded. Its recorded sharing time, rather than generation, preview, download, or email transport, begins the Validation Window.
_Avoid_: generated draft, downloaded draft

**Draft Sharing Record**:
The recipient, delivery method, sender attestation, and sharing time for a Shared Validation Draft. A transport identifier may supplement the record but is not required.
_Avoid_: email receipt, download event

**Validation Window**:
The standard five-business-day opportunity for the Assessment Contractor to identify data errors in a Validation Draft. A different duration requires a reason recorded by the Issuing Authority.
_Avoid_: dispute period, informal waiting period

**Final Assessment**:
The immutable assessment formally issued by the Issuing Authority. Its issuance begins the Agreement's dispute period.
_Avoid_: generated report, current assessment

**Finalized Assessment**:
An internally approved assessment ready for issuance. Finalization alone creates no contractor deadline or contractual issuance effect.
_Avoid_: Final Assessment, issued assessment

**Superseding Final Assessment**:
A newly reviewed and issued Final Assessment that corrects an earlier Final Assessment while preserving the earlier artifact and restarting the dispute period.
_Avoid_: edited final, overwritten report

**Not Assessable**:
The explicit outcome for a required standard whose evidence or measurement is insufficient. It is neither compliance nor noncompliance and cannot silently be treated as meeting the standard.
_Avoid_: meets, zero penalty, missing

**Below-standard Outcome**:
A Warning, Tier 1, or Tier 2 result. It advances an Escalation Streak even when the result carries no immediate monetary penalty.
_Avoid_: penalty month, failed month

**Escalation Streak**:
The sequence of assessed Below-standard Outcomes for the same performance standard. Meets resets the streak, while Not Assessable or an unissued month pauses it without advancing or resetting it; escalation begins with the third qualifying outcome.
_Avoid_: calendar-month count, penalty count

**Assessment Exception**:
The Issuing Authority's explicit authorization to issue a Final Assessment containing a Not Assessable standard. It identifies the reason, missing-data owner, remediation action, and expected correction date.
_Avoid_: waiver, ignored data

**Partial Assessed Total**:
The sum of assessed standards when one or more required standards are Not Assessable. It is explicitly incomplete and must not be presented as the complete monthly assessment total.
_Avoid_: total assessed, zero for missing data

**Material Assessment Change**:
A post-sharing change to assessment status, evidence, tier, penalty, exception, or total. It requires a replacement Validation Draft and a new Validation Window; formatting-only changes are not material.
_Avoid_: edit, correction

**Material Late Information**:
Information received after final issuance that changes a tier, monetary amount, CAP requirement, Not Assessable outcome, or dispute right. The Issuing Authority may classify other late information as material only with a recorded rationale.
_Avoid_: correction, note

**Source Correction**:
A correction to assessment evidence or measurement made at its authoritative source. It requires recomputation and is not a review adjustment.
_Avoid_: manager adjustment, report edit

**Assessable Input**:
The source measurement or occurrence set remaining after contractually approved exclusions are applied. Performance tiering uses the Assessable Input while preserving the raw input for explanation.
_Avoid_: adjusted penalty, reviewed value

**Monetary Adjustment**:
An Assessment Reviewer's reasoned recommendation to change a computed monetary amount without rewriting its source measurement or tier.
_Avoid_: source correction, waiver

**Binding Adjustment**:
The Issuing Authority's acceptance of a recommended Monetary Adjustment or Penalty Waiver. An adjustment may increase or decrease an amount only on a stated contractual basis and may never reduce it below zero.
_Avoid_: reviewer decision, source correction

**Penalty Waiver**:
An Assessment Reviewer's reasoned recommendation not to collect a computed penalty. It does not change the underlying performance outcome or automatically remove a CAP requirement.
_Avoid_: Meets, source correction

**CAP Determination**:
The decision that a Corrective Action Plan is required because of the underlying performance or safety outcome. It remains independent of a Monetary Adjustment or Penalty Waiver and requires a separate reasoned decision to remove.
_Avoid_: penalty add-on, automatic waiver

**Assessment Credit**:
A non-negative financial remedy resulting from a dispute against an issued Final Assessment. It remains linked to that assessment and is handled outside another Assessment Period's calculation.
_Avoid_: negative penalty, next-month adjustment

**Escalation Impact**:
The set of later Assessment Periods whose Escalation Streak changes after an earlier Source Correction or supersession. Unissued affected periods become stale; issued affected periods require an explicit supersession decision.
_Avoid_: silent recalculation, isolated correction

**Assessment Evidence Version**:
An immutable, content-hashed artifact or structured source reference supporting an assessment input or decision. A correction creates a linked version rather than replacing evidence already used by a Shared Validation Draft or Final Assessment.
_Avoid_: attachment, current file

**Assessment Item**:
A specific standard, occurrence, adjustment, waiver, exception, or CAP Determination within a Final Assessment that may be identified in a dispute.
_Avoid_: whole report, generic penalty

**Assessment Dispute**:
A contractor challenge to one or more identified Assessment Items in a Final Assessment. Items outside the stated scope remain final.
_Avoid_: report rejection, informal comment

**Dispute Outcome**:
The final disposition of an Assessment Dispute: Upheld, Adjusted, Rescinded, or Superseded.
_Avoid_: closed, resolved

**Assessment Lifecycle**:
The progression of an Assessment Period through Open, Under Review, In Validation, Finalized, and Issued. Stale identifies material input change; an issued assessment is never moved backward and corrections proceed through supersession.
_Avoid_: computation status, report status

**Unassigned Candidate**:
An automated observation that cannot be placed unambiguously within the Assessment Contractor's Agreement term. It cannot contribute to an Assessment Period.
_Avoid_: contractor occurrence, ignored candidate

**Candidate Resolution**:
The explicit confirmation, dismissal, deferral, or reassignment of an automated candidate. An unresolved in-term candidate prevents finalization of its Assessment Period.
_Avoid_: ignored candidate, assumed dismissal

**Emergency Separation Override**:
Authorization for one person to review and issue the same assessment during an emergency. A different administrator or executive authority must record the authorization and reason; self-authorization is prohibited.
_Avoid_: admin bypass, self-approval

**Superseded Dispute**:
A preserved dispute closed because a Superseding Final Assessment replaced the assessment it challenged. The superseding assessment creates a new dispute period rather than carrying the former dispute forward.
_Avoid_: deleted dispute, transferred dispute

**Procedure**:
Governed operational guidance for responding to a service condition or
incident. A Procedure has a structured Decision Matrix entry for discovery
and a source document, initially maintained in SharePoint, for the complete
approved guidance.
_Avoid_: static help article, unapproved note

**Decision Matrix Entry**:
The searchable, structured summary of a Procedure: its condition, observable
criteria, severity meaning, immediate actions, references, and governance
metadata. It is not a separate procedure version and must identify the exact
Procedure revision it summarizes.
_Avoid_: incident record, free-form tip

**Operational Exception**:
A future operational record representing a detected or manually created
service condition that requires a controller's review against a Procedure.
It may later capture acknowledgement, ownership, actions, escalation,
communication, notes, and resolution, but it is not an Event, Service Plan,
or Event operating context.
_Avoid_: alert, Event, Service Plan
