# Domain Context

## Event

A real-world public-service occasion that may require special transit
operations. An event is not itself a route classification or a service plan.

## Route classification

The operational category assigned to a route, such as `SpecialEvent`,
`FixedRoute`, or `OnDemand`. A route classification describes what kind of
service a route represents; it does not by itself activate monitoring for a
particular occasion.

A route classification also owns the operator-facing display label and Event
AVL marker color for that route. The label is used anywhere Event AVL names
the route, including vehicle details, map popups, and newly created status
queue messages; the color identifies its live vehicle markers. These are
presentation attributes and do not alter monitoring eligibility or scope.

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

## Monitoring Area test

An explicitly time-limited, operator-configured check that detects any vehicle
exiting a selected Monitoring Area and sends a clearly marked test message. It
is independent of Event and Service Plan scope.

## Monitoring Area test watch

One configured pair of a reference location and the Monitoring Area that
surrounds it. The location identifies the place or corridor to operators; the
area provides the actual boundary used for exit detection.

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
direction rule matches the vehicle heading. It creates a manual-review Status
queue item but cannot trigger automatic external delivery.

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

## Event Plan

The canonical operator-facing label for one Event's time-bounded plan in the
Event Planning console. In domain, API, audit, and lifecycle language this is
still a Service Plan: the label does not change the Service Plan entity or the
meaning of an operating period.

## Operational observation

An observed runtime fact, such as a vehicle entering or leaving a geofence.
An observation is retained for monitoring and audit before any notification or
other operational action is selected.

## Boundary-interpolated crossing

A crossing inferred where the straight path between two consecutive vehicle
positions intersects a Monitoring Area boundary. It captures a movement even
when neither position is recorded inside the area.

## Qualified boundary movement

A boundary-interpolated crossing whose consecutive positions are at least 25
metres apart. The movement may be recorded as an entry and an exit when a
vehicle passes completely through a Monitoring Area between reports.

## Movement notification cooldown

The 60-second period during which repeated notifications for the same vehicle,
Monitoring Area, and movement type are suppressed. The underlying movements
remain in the Event audit.

## Pass-through movement

A qualified boundary movement that enters and exits a Monitoring Area between
two reports. Its entry and exit are independent movements that each evaluate
their own direction rule.

## Detected time

The timestamp of the GPS report that confirms a boundary movement. It is not
an estimated physical crossing time.

## Monitoring Area hole

An excluded inner space within a Monitoring Area. A vehicle in a hole is
outside the Monitoring Area, so crossing its boundary is an entry or exit.

## Interpolation window

The maximum time between consecutive GPS reports that allows a
boundary-interpolated crossing. It is two effective polling intervals; later
reports use point-based confirmation only.

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
and any matched rule or destination. It does not include an ETA unless a
reliable ETA source is available.

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

**Watch condition**:
A current service observation that merits operational attention but has not
crossed its service-risk threshold. It is not a Service risk.
_Avoid_: minor risk, at-risk service, near breach

**Training scenario**:
An explicitly labeled, non-operational service-risk example used to rehearse
the fixed-route or on-demand workflow. It must never be presented as Live data.
_Avoid_: test risk, simulated live incident, demo data

**Not-connected monitoring**:
The trust state in which a Service Risk & Quality source has not passed its
required operational activation gate. It cannot make claims about service risk.
_Avoid_: no risks, unavailable service, Live data

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
incident. OnBoard owns a Procedure's structured Decision Matrix content,
revision, and governance; SharePoint stores its supporting source documents
for the complete approved guidance.
_Avoid_: static help article, unapproved note

**Procedure Revision**:
An immutable version of a Procedure's governed content. A new or corrected
Procedure Revision supersedes a prior revision without changing the guidance
or document references that were previously approved.
_Avoid_: edited approved procedure, current row

**Procedure Revision Lifecycle**:
The governed progression of a Procedure Revision: Draft, Under review,
Approved, Superseded, or Retired. Draft is editable; Under review is returned
to Draft with a reason when changes are needed; Approved is immediately
effective; Superseded and Retired are terminal and may only be used as the
source for a new Draft.
_Avoid_: direct approved edit, reactivated revision

**Procedure Identity**:
The durable `procedure_id` and `condition_key` of a Procedure. They remain
unchanged after approval so that recommendations, reporting, and audit retain
their meaning; a materially different condition is a new Procedure.
_Avoid_: renamed key, recycled procedure

**Procedure Withdrawal**:
The exceptional retirement of the only effective Procedure Revision because
its guidance is dangerous or invalid. It requires prominent confirmation and
a recorded reason; ordinary retirement requires an approved replacement.
_Avoid_: ordinary retirement, silent removal

**Criterion**:
An ordered, observable statement on a Procedure Revision that says when the
Procedure applies or does not apply. A Criterion is either an inclusion or an
exclusion; it is not an unstructured note.
_Avoid_: tag, free-form tip

**Immediate Action**:
An ordered instruction on a Procedure Revision that is required, conditional,
or informational. It is guidance, not a completed-action record; a later
Operational Exception may record its outcome.
_Avoid_: incident action, checklist completion

**Supporting Document Reference**:
The controlled link between a Procedure Revision and a source document stored
in SharePoint. It identifies the expected document and its validation state,
but does not author or overwrite Procedure content. A Procedure Revision may
have multiple Supporting Document References, all frozen with that revision.
_Avoid_: content sync, procedure source of truth

**Primary Supporting Document Reference**:
The one required Supporting Document Reference for a Procedure Revision. It
is an SOP or Reference and provides the unambiguous source-document action;
any other references are ordered, labelled supporting material.
_Avoid_: arbitrary first link, visual rendition

**Document Reference Health**:
The observed availability and revision alignment of a Supporting Document
Reference. A failed check makes the reference visible as needing review but
does not silently revise, hide, or retire its approved Procedure Revision.
An updated source document also requires a reviewed Procedure Revision before
it becomes the referenced approved version.
_Avoid_: procedure status, content freshness

**Procedure Match Rule**:
An explicit, source-qualified rule that recommends a Procedure for an
operational condition. It carries its priority and explanation and may produce
multiple recommendations; it never selects a Procedure Revision automatically.
_Avoid_: free-text guess, automatic procedure selection

**Quick Reference Guide (QRG)**:
A controlled supporting guide that helps a controller scan a Procedure. It is
not an eligible primary source document and never replaces the governing SOP
or Reference.
_Avoid_: primary procedure, uncontrolled cheat sheet

**Document Rendition**:
An approved PNG or JPEG visual companion to a Supporting Document Reference.
It helps orient a controller but never replaces the text-based Criteria or
Immediate Actions that govern the response.
_Avoid_: source document, visual-only procedure

**Procedure Audit Event**:
An append-only record of a saved Procedure Revision or Supporting Document
Reference change, lifecycle decision, or document-reference health result. It
identifies the actor, time, affected revision, and reason or content change
without recording unsaved keystrokes.
_Avoid_: activity log, edit history

**Procedure Severity**:
A controlled, plain-language classification of a Procedure Revision's
operational significance: Stop service, Restrict service, or Routine / no
escalation. It helps a controller scan and interpret guidance; it does not
automatically dispatch, escalate, or communicate on its own.
_Avoid_: automation trigger, incident state

**Procedure Owner**:
The operational team accountable for a Procedure Revision's correctness and
review. It is distinct from the Admin who authors or approves the revision and
may name an individual contact for practical escalation.
_Avoid_: approver, current editor

**Procedure Review Date**:
The next date by which an approved Procedure Revision must be reviewed. It
defaults to six months after approval unless an Admin selects a shorter period;
passing the date makes the revision need review but does not retire it.
_Avoid_: expiry, automatic retirement

**Procedure Recommendation**:
An explainable, non-binding suggestion that a Procedure may help with an
operational record. It may use a controlled condition key or keyword match,
but it never selects or records a Procedure Revision without a controller's
explicit later action.
_Avoid_: automatic procedure selection, Procedure Instance

**Decision Matrix Entry**:
The searchable, structured summary of a Procedure: its condition, observable
criteria, severity meaning, immediate actions, references, and governance
metadata. It is app-owned, is not a separate procedure version, and must
identify the exact Procedure revision it summarizes.
_Avoid_: incident record, free-form tip

**Operational Exception**:
A future operational record representing a detected or manually created
service condition that requires a controller's review against a Procedure.
It may later capture acknowledgement, ownership, actions, escalation,
communication, notes, and resolution, but it is not an Event, Service Plan,
or Event operating context.
_Avoid_: alert, Event, Service Plan

## Access management language

**Access Principal**:
A human user, Entra group, or workload identity that may receive access to
MVTA OnBoard. An Access Principal is not a locally managed login account.
_Avoid_: imported user, local user

**Directory Onboarding**:
The selection of an existing Entra user or group and the granting of OnBoard
access. It does not copy credentials or mirror the directory into OnBoard.
_Avoid_: AD import, user import, account creation

**Effective Access**:
The complete set of OnBoard capabilities a human receives from direct app-role
assignments and direct membership in assigned Entra groups.
_Avoid_: primary role, imported permissions

**OnBoard Access Management**:
The administration of access specifically to MVTA OnBoard, including grants,
revocations, Directory Onboarding, and access review. It does not include
tenant-wide Entra account administration.
_Avoid_: Entra administration, login database

**Access Administrator**:
A human authorized to manage OnBoard access through the dedicated
`OCC.AccessAdmin` authority. Operational administration alone does not make a
person an Access Administrator.
_Avoid_: OCC Admin, Entra admin, user manager

**Privileged Access Change**:
A grant or revocation of `OCC.Admin` or `OCC.AccessAdmin` authority. It requires
approval by a second, distinct authorized person.
_Avoid_: ordinary role change, self-approval

**Guest Sponsorship**:
The accountable relationship linking a B2B guest's OnBoard access to an MVTA
sponsor, employer, justification, and expiry.
_Avoid_: guest import, permanent contractor account

**OnBoard Break-glass Path**:
The IT-controlled Entra/Portal recovery path used to restore privileged OnBoard
access when the in-app approval path cannot operate.
_Avoid_: admin bypass, shared emergency login

## Missed-trip language

**Missed-trip candidate**:
A scheduled run flagged by operational evidence as possibly canceled, not
operated, or started more than 30 minutes late. It requires investigation and
is not itself a contractual determination.
_Avoid_: confirmed missed trip, automatic violation

**Trip start**:
The departure of a run from its first scheduled public stop in passenger
service. Assignment, feed presence, or observed progress may provide evidence
of Trip start but are not the event itself.
_Avoid_: first observation, vehicle assignment

**Timely service**:
A run whose Trip start occurs no more than 30 minutes after its scheduled Trip
start. A start exactly 30 minutes late remains Timely service.
_Avoid_: observed on time, appeared in feed

**Confirmed missed trip**:
A human-reviewed determination that a scheduled run did not operate or its Trip
start occurred more than 30 minutes late. Cancellation evidence is preserved
but may be superseded by evidence of Timely service.
_Avoid_: missed-trip candidate, unresolved alert

**First observed progress**:
The earliest trustworthy observation that a run advanced beyond its first
scheduled public stop. It bounds when Trip start occurred but is not itself the
measured Trip start.
_Avoid_: actual start, first arrival

**Indeterminate trip**:
A scheduled run whose outcome cannot be classified because the available
evidence is insufficient. It remains visible for investigation but does not
count as a Confirmed missed trip.
_Avoid_: missed trip, suppressed record

**Data coverage gap**:
Missing or unreliable operational evidence during a run's decision window that
prevents absence from supporting a missed-trip determination.
_Avoid_: no-show, zero vehicles

**Partial-service failure**:
A run that operated but failed to provide a scheduled portion of passenger
service, such as serving its first public stop. It is distinct from a whole
missed trip and from Timely service.
_Avoid_: missed trip, missed stop resolved

**Published Trip start**:
The Trip start time in the passenger-facing schedule that governs the 30-minute
missed-trip threshold. A dispatch change replaces it only when the governing
agreement recognizes the replacement schedule.
_Avoid_: latest dispatch estimate, first feed time

**Missed-trip evidence finding**:
The system's current interpretation of operational evidence for a scheduled
run, independent of investigation workflow or human determination.
_Avoid_: status, review outcome

**Missed-trip review outcome**:
A human determination that a run was a Confirmed missed trip, Timely service,
a Partial-service failure, or an Indeterminate trip.
_Avoid_: false positive, workflow status

**Service attribution**:
The separate determination of whether a confirmed service failure is
contractor-caused, excusable, agency-directed, or unattributed.
_Avoid_: missed-trip outcome, reason code

**Suspected no-show**:
A Missed-trip candidate created when Timely service has not been established by
the 30-minute deadline. It does not become a Confirmed missed trip until the
expected operating window closes and retrospective evidence or human review
supports that conclusion.
_Avoid_: confirmed no-show, automatic missed trip

**Retrospective reconciliation**:
The comparison of a scheduled run and its live evidence with later operational
records after the expected operating window closes. A source match may be
exact, probable, or unmatched and does not replace human confirmation.
_Avoid_: automatic confirmation, feed import

**Superseding missed-trip review**:
A new review that corrects an earlier Missed-trip review outcome while
preserving the former decision, evidence, reviewer, and reason.
_Avoid_: overwritten review, reopened decision

**Late-arrival failure**:
A contract-specific service-quality failure based on arrival performance. It
is distinct from the missed-trip rule based on Trip start unless the governing
agreement explicitly equates them.
_Avoid_: missed trip, late start

**Qualifying progress evidence**:
A source-timestamped observation whose trip, service date, stop sequence, and
vehicle status coherently place the run at or traveling toward a scheduled stop
after its first public stop. Position movement may corroborate but is not
required.
_Avoid_: feed presence, vehicle assignment

**Decision coverage**:
Reliable trip-observation coverage from Published Trip start through its
30-minute deadline, with no observation-system gap longer than 10 minutes.
Without Decision coverage, absence supports an Indeterminate trip rather than
a Suspected no-show.
_Avoid_: last successful poll, feed enabled

**Missed-trip case**:
The single investigation record for one scheduled run, containing preserved
live and retrospective evidence from every matched source.
_Avoid_: feed row, duplicate candidate

**Advance cancellation**:
Cancellation evidence received before Published Trip start that creates an
immediate provisional Missed-trip candidate. The case remains subject to
Timely service evidence through the 30-minute deadline.
_Avoid_: confirmed missed trip, final cancellation

**Scheduled-run identity**:
The canonical identity of one expected run on one service date. Evidence from
other systems links to it through route, Published Trip start, block or run,
and service type rather than vehicle number alone.
_Avoid_: vehicle identity, feed record ID

**Evidence-match confidence**:
The recorded strength of a cross-system link to a Scheduled-run identity:
exact, probable, or unmatched. Probable links require reviewer confirmation
before affecting a Missed-trip case.
_Avoid_: best guess, automatic merge

**Legacy missed-trip record**:
A preserved detection produced by logic that cannot support current compliance
standards. It remains available for explicit rereview but is excluded from
compliance totals by default.
_Avoid_: corrected history, confirmed missed trip

**Shadow detection**:
Operation of a candidate detector for evaluation without automatic contractual
promotion. A detector leaves Shadow detection only after a complete service
week demonstrates at least 95 percent precision while reporting indeterminate
and unmatched cases separately; on-demand service-quality additionally requires
two complete service weeks, dispatcher agreement, and no unresolved feed-health
issue.
_Avoid_: production truth, enabled detector

**Missed-trip review authority**:
Operations authority to determine the service outcome represented by a
Missed-trip case. It does not determine Service attribution or assessment
treatment.
_Avoid_: compliance approval, contractor fault

**Retained missed-trip evidence**:
Operational evidence cited by a missed-trip review or assessment and preserved
under contractual retention even after its source telemetry expires.
_Avoid_: live telemetry, temporary feed data

**Missed-trip case lifecycle**:
The workflow progression of a Missed-trip case: Open, Awaiting evidence, Ready
for review, Reviewed, or Superseded. Lifecycle state is separate from the
Missed-trip evidence finding and Missed-trip review outcome.
_Avoid_: resolved status, evidence finding

**Timely-service closure**:
The preserved closure of a Missed-trip case when Qualifying progress evidence
proves Timely service. It may close an unreviewed case automatically, but it
cannot silently rewrite an existing human review.
_Avoid_: deleted candidate, false positive

**Evidence conflict**:
Two or more exact-matched sources that support incompatible Missed-trip
evidence findings. An Evidence conflict requires review and source provenance;
it is never resolved by an undocumented source priority.
_Avoid_: duplicate evidence, feed error

**Expected operating window**:
The period from Published Trip start through the scheduled final-stop time plus
30 minutes. A Suspected no-show is not eligible for final confirmation until
this window and the required retrospective source-availability SLA have ended.
_Avoid_: service day, polling window

**Service-specific Trip start**:
The agreement-defined first passenger-service event for a service type. Fixed
route service uses departure from its first scheduled public stop; demand-
responsive service uses its first committed passenger pickup or service-slot
start.
_Avoid_: universal first stop, first feed observation

**Schedule snapshot**:
The authoritative passenger schedule effective for one local service date and
retained as the expected-run baseline for later review. A later schedule does
not rewrite the snapshot used for an existing Missed-trip case.
_Avoid_: current static feed, mutable schedule

**Post-publication cancellation**:
A cancellation of a run after it was present in the effective Schedule
snapshot. It creates an Advance cancellation; removing a run before the
snapshot became effective is a schedule correction, not a canceled run.
_Avoid_: schedule edit, final cancellation

**Closed by evidence**:
A Missed-trip case closed automatically because Qualifying progress evidence
proved Timely service. It is distinct from a human Reviewed case and remains
auditable with its evidence and closure reason.
_Avoid_: reviewed, resolved

**Assessment promotion**:
The gated transition by which a Confirmed missed trip becomes eligible for
contractor-performance assessment. It requires retained supporting evidence
and contractor-caused Service attribution.
_Avoid_: automatic KPI inclusion, confirmed outcome

**Unattributed service failure**:
A Confirmed missed trip whose Service attribution is excusable, agency-
directed, or undetermined. It remains operational history but does not promote
to contractor-performance assessment.
_Avoid_: dismissed missed trip, false positive

**Reviewed indeterminate outcome**:
A human-reviewed conclusion that the available evidence cannot establish
Timely service or a Confirmed missed trip. It closes the investigation without
entering missed-trip or contractor-fault totals.
_Avoid_: incomplete review, dismissed case

**Assessment evidence gate**:
The requirement that unresolved Evidence conflicts and unsupported source links
block Service attribution and Assessment promotion while preserving the
underlying operational outcome.
_Avoid_: source preference, automatic reconciliation

## On-demand service quality

**Active on-demand request**:
A passenger request that has not reached a terminal pickup, cancellation, or
dropoff outcome and remains eligible for live service-quality monitoring.
_Avoid_: active trip, open booking

**Pickup commitment**:
The scheduled pickup timestamp promised for an on-demand request; the requested
pickup timestamp is its fallback only when a scheduled pickup is absent.
_Avoid_: vehicle ETA, arrival estimate

**Observed service risk**:
The current condition in which an Active on-demand request is overdue against
its Pickup commitment or has exceeded its applicable Service standard.
_Avoid_: missed trip, predicted delay

**Service standard**:
The maximum permitted minutes after a Pickup commitment before a request is
considered to have exceeded its on-demand service target. The all-zones default
is 25 minutes unless a valid Zone override applies.
_Avoid_: vehicle ETA, wait prediction

**Zone override**:
A reasoned, time-bounded exception to the all-zones Service standard for one
operational Zone. It applies immediately to active requests in that Zone and
expires without operator action.
_Avoid_: permanent zone setting, informal exception

**Operational zone**:
A versioned GTFS-Flex service area that classifies an on-demand request by its
pickup coordinate for service-quality monitoring.
_Avoid_: route, vehicle territory

**Reconciliation**:
The hourly refresh of authoritative active-request data used to recover from
late, missing, or out-of-order real-time feed deliveries.
_Avoid_: live event, polling-only monitoring

**Projected risk**:
A forecast that a request may exceed its applicable Service standard, derived
from ETA or vehicle-location information. It is operational context, not an
Observed service risk or a completed service-quality outcome.
_Avoid_: observed failure, confirmed delay

**Overdue request**:
An Active on-demand request whose Pickup commitment has passed without a
confirmed pickup but has not yet exceeded its applicable Service standard.
_Avoid_: standard exceeded, missed trip

**Standard-exceeded request**:
An Active on-demand request whose uncompleted wait is beyond its applicable
Service standard.
_Avoid_: projected risk, late vehicle

**Critical request**:
A Standard-exceeded request that is at least 15 minutes beyond its applicable
Service standard.
_Avoid_: high-priority estimate, missed trip

**Service-quality intervention**:
An internal Suggested Alert created for a Standard-exceeded or Critical
request. It does not contact a rider or an external party.
_Avoid_: automated rider notification, service failure

**Service-day quality rollup**:
The cumulative counts and rates of distinct on-demand requests for one local
service day, calculated by the request's single Operational zone and again for
all Zones.
_Avoid_: sum of zone percentages, live snapshot total

**Original pickup commitment**:
The Pickup commitment first recorded for an accepted request. It remains
historical evidence when a request is later rescheduled.
_Avoid_: current pickup commitment, mutable promise

**Unzoned request**:
An on-demand request whose pickup cannot be assigned to exactly one active
Operational zone. It remains visible in all-zones quality results with an
explicit data-quality condition.
_Avoid_: excluded request, default zone

**Risk evaluation record**:
A retained, non-PII explanation of one service-risk result, including the
request, zone version, applicable Service standard, timestamps, outcome, and
source freshness.
_Avoid_: raw webhook archive, rider record

**Degraded feed**:
The trust state entered when the authoritative Reconciliation has not completed
within 90 minutes. Last-known risks remain visible, but new Service-quality
interventions are suspended until current data returns.
_Avoid_: no risks, healthy feed

**Service-standard authority**:
The Service Operations administrator authority to set the all-zones Service
standard or a Zone override. Dispatchers may act on Service-quality
interventions but cannot change the policy.
_Avoid_: dispatcher preference, shared setting

**Rescheduled risk**:
An active Observed service risk that is no longer current because a later
Pickup commitment changes its applicable evaluation. Its earlier Risk
evaluation record remains historical evidence.
_Avoid_: deleted risk, corrected history

**Source-state precedence**:
The rule that a newer authoritative request state may update an Active
on-demand request, while an older delivery remains audit information only and
cannot overwrite it.
_Avoid_: last received wins, retry state

**On-demand feed boundary**:
The limited integration that accepts only request-status, ETA, vehicle-location,
and duty-matching updates; authenticates them before processing; and retains
only whitelisted non-PII facts.
_Avoid_: vendor payload archive, rider integration

**Authoritative pickup evidence**:
The Spare Request Status record used to establish request lifecycle and
confirmed pickup. Duties and Driver Operations are corroborating operational
evidence and do not silently replace it.
_Avoid_: driver event override, vehicle estimate

**Effective service outcome**:
The completed on-demand request outcome calculated from the Pickup commitment
and Service standard effective at confirmed pickup. Later policy changes do
not recalculate it; rescheduling is reported separately.
_Avoid_: retroactive score, current-policy outcome

**Monitoring-incomplete request**:
An Active on-demand request lacking both a scheduled and requested Pickup
commitment. It is visible in data quality but excluded from service-quality
rates because no defensible wait clock exists.
_Avoid_: zero-wait request, unmonitored request

**Zone assignment snapshot**:
The one Operational-zone version assigned from a request's pickup coordinate
when it is first evaluated. It is retained for that request's history even when
later GTFS-Flex geography changes.
_Avoid_: current zone lookup, retroactive remapping

**Open service-quality intervention**:
The single active Service-quality intervention for one request. It is updated
as the risk changes and closes at pickup, cancellation, rescheduling,
projected-risk recovery, or an explicit manual resolution.
_Avoid_: duplicate alert, recurring intervention

## Feed-backed KPI observability

**KPI feed dependency**:
An identified upstream feed whose current, complete input is required for an
operational KPI to be interpreted as current. A KPI may depend on more than
one feed.
_Avoid_: optional diagnostic, interchangeable source

**KPI trust state**:
The operational status of a feed-backed KPI. It is Current only when every
required KPI feed dependency satisfies its freshness contract; otherwise it is
Stale and its last-known value remains context rather than a current
operational conclusion.
_Avoid_: feed connection result, no data, current KPI value

**Required KPI feed dependency**:
A KPI feed dependency whose stale or unavailable state makes the KPI Stale.
_Avoid_: supporting evidence, optional enrichment

**Supporting KPI feed dependency**:
A KPI feed dependency that adds context or confidence without determining the
KPI trust state by itself.
_Avoid_: required KPI feed dependency, substitute source

**Stale-data acknowledgement**:
The recorded human reason required before a staff member uses a Stale KPI as
context for a manual communication. It never reclassifies the KPI as Current
or permits an automatic action.
_Avoid_: freshness override, automatic exception

**Freshness contract**:
The expected update cadence and allowed lateness for one KPI feed dependency.
It is evaluated according to that source's real-time, daily, or monthly
operating cycle rather than a universal elapsed-time threshold.
_Avoid_: one-hour rule, source connection test

**KPI trust view**:
The operator-facing presentation of KPI feed dependencies and the resulting
KPI trust state. The Admin view compares all dependencies; each KPI view
states its own trust state at the point of operational use.
_Avoid_: raw feed log, hidden technical diagnostic

**KPI trust authority**:
The separation in which Administrators maintain KPI dependencies and
Freshness contracts, while dispatch or OCC staff may record a
Stale-data acknowledgement for a manual communication.
_Avoid_: shared configuration, freshness override

**KPI source stream**:
A distinct evidence and result path within a compound KPI. Each source stream
has its own required and supporting feed dependencies and its own KPI trust
state, so a disruption in one stream does not conceal a current result from
another.
_Avoid_: one all-or-nothing status for unrelated sources

**Current-but-empty KPI**:
A KPI source stream whose required dependencies have completed within their
Freshness contracts but produced no qualifying records. It is Current, with an
empty result, rather than Stale.
_Avoid_: no data, failed ingestion

**Delivery freshness**:
Whether a feed ingestion has completed within its allowed lateness. It reports
the health of delivery and processing, independently of what period the source
data represents.
_Avoid_: current source data, source coverage

**Data coverage**:
The service period represented by the newest successfully ingested source data.
A current KPI requires both Data coverage for its expected period and Delivery
freshness for its Freshness contract.
_Avoid_: last poll time, ingestion success

**Stale-data acknowledgement record**:
The auditable record attached to a manual communication that uses stale KPI
context. It identifies the KPI source stream, staff member, timestamp, and
reason; it does not change the KPI trust state.
_Avoid_: freshness override, generic activity log
