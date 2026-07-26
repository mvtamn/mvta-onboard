# MVTA OnBoard — Suggested Improvements

**Prepared:** July 26, 2026  
**Purpose:** Discussion draft for product, operations, UX, and technical review

This document consolidates suggested improvements for MVTA OnBoard based on
its intended role as a companion to MVTA's CAD/AVL systems.

It should be read with `CURRENT_STATE.md`, which describes the repository as it
exists today. This document proposes a future direction; it does not claim
that the features below are already implemented.

## 1. Refined product purpose

MVTA OnBoard should operate as an operational exception-detection and customer
communication layer. It should fill monitoring and communication gaps that
the existing CAD/AVL platforms do not adequately address.

Its primary purpose is to:

1. Proactively identify fixed-route trips that are likely to depart more than
   15 minutes late.
2. Proactively identify on-demand customers who are likely to wait more than
   25 minutes.
3. Give control center staff enough warning and evidence to intervene.
4. Prepare a clear customer communication for staff review.
5. Publish approved alerts across multiple digital channels.
6. Monitor recovery and recommend when an alert should be revised or closed.
7. Consolidate and digitize OCC operating procedures through a searchable,
   governed Decision Matrix.
8. Produce defensible OTP compliance calculations and contractor scorecards,
   including approved stop- and event-based exclusions.
9. Help controllers identify and respond to credible speeding events.
10. Allow OCC to watch selected vehicles and service performance during
    special events.

The system should not replace CAD/AVL or automatically make final operational
decisions. It should combine available data, identify likely service-quality
failures, explain the evidence, and keep a person in the approval loop.

The product therefore has six related operating pillars:

1. Fixed-route service-risk prediction
2. On-demand wait-time prediction
3. Customer communication
4. OCC decision support and procedure governance
5. OTP compliance and contractor performance
6. Safety and special-event monitoring

## 2. Core service-quality standards

| Service | Primary measure | Poor-service threshold |
| --- | --- | ---: |
| Fixed route | Predicted departure delay | More than 15 minutes late |
| On-demand | Predicted customer wait time | More than 25 minutes |

These standards should drive prediction logic, exception severity, dashboard
ordering, suggested alerts, and performance reporting.

### Fixed-route question

> At which future stop is this trip predicted to depart more than 15 minutes
> late, and how soon will that happen?

### On-demand question

> Is this customer's total wait likely to exceed 25 minutes, and can the
> control center intervene before it does?

## 3. Recommended operating workflow

```text
CAD/AVL, GTFS, on-demand, traffic, and weather data
                         |
                         v
              Calculate service-quality risk
                         |
                         v
          Predict a threshold will be exceeded
                         |
                         v
       Explain the prediction, confidence, and impact
                         |
                         v
       Control center reviews and selects an action
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Operational response     Customer communication
                                     |
                                     v
                     Web, SMS, email, push, signage
                                     |
                                     v
                      Monitor recovery and close alert
```

Automated detection should create a reviewable exception or Suggested Alert.
It should never publish a customer-facing alert without authorized staff
approval.

## 4. Fixed-route prediction improvements

### 4.1 Use departures as the operational measure

MVTA operates and measures fixed-route performance using departures rather
than arrivals.

The principal calculation should therefore be:

```text
departure delay =
  predicted departure time
  - scheduled departure time
```

Arrival information remains useful for determining travel time, dwell time,
and vehicle progress, but it should not drive the 15-minute threshold.

The application should retain separate fields such as:

- `scheduled_arrival`
- `predicted_arrival`
- `arrival_delay_seconds`
- `scheduled_departure`
- `predicted_departure`
- `departure_delay_seconds`
- `dwell_seconds`

The current TripUpdate mapper prefers `Arrival.Delay` and uses
`Departure.Delay` as a fallback. At minimum, this order should be reversed.
The longer-term solution should retain both arrival and departure events for
every relevant stop.

### 4.2 Compare the complete static and realtime feeds

Static versus realtime comparison is sufficient for a strong first version
of schedule adherence and stop-level prediction, but the system must use more
of both feeds than it does today.

The static GTFS synchronization should import:

- `stop_times.txt`
- `calendar.txt`
- `calendar_dates.txt`
- `shapes.txt`
- `trips.txt`, including `block_id`
- Existing stops, routes, trips, directions, and headsigns

The realtime integration should retain:

- Every upcoming `StopTimeUpdate`, not only the first one
- Arrival and departure events
- Absolute predicted times when supplied
- Delay values
- Stop sequence
- Trip start date and start time
- Schedule relationships
- Canceled, skipped, new, and replacement trips
- Prediction uncertainty
- Feed and entity timestamps

For each stop, the application should:

1. Prefer a realtime absolute departure time when available.
2. Otherwise add the realtime departure delay to the static departure time.
3. Propagate delay only as permitted by GTFS-Realtime rules.
4. Respect `SKIPPED`, `NO_DATA`, canceled, new, and replacement relationships.
5. Use `stop_sequence` to distinguish repeated visits to the same stop.
6. Mark predictions unknown when the feed does not provide enough data.
7. Never assume a missing TripUpdate means a trip is on time.

### 4.3 Retain observation history

The current monitoring table is useful for displaying the latest state but
does not retain enough history to measure trends or prediction accuracy.

Keep a current-state table for fast reads and add an append-only observation
table containing fields similar to:

```text
TripDelayObservations
- service_date
- trip_id
- vehicle_id
- route_id
- direction_id
- stop_sequence
- stop_id
- observed_at
- feed_timestamp
- scheduled_departure
- predicted_departure
- departure_delay_seconds
- scheduled_arrival
- predicted_arrival
- arrival_delay_seconds
- uncertainty_seconds
- latitude
- longitude
- speed_mps
```

This history would support:

- Worsening, stable, and recovering trends
- Prediction volatility
- Segment travel-time estimates
- Stop dwell-time estimates
- Feed-quality analysis
- Model evaluation
- Historical replay

### 4.4 Predict the first threshold crossing

The prediction service should calculate:

- Current departure delay
- Predicted departure delay at every remaining stop
- Predicted maximum delay
- First stop projected above 15 minutes
- Expected time until threshold crossing
- Predicted terminal departure or completion time
- Remaining schedule recovery
- Downstream vehicle-block impact

An explainable initial model could use:

```text
predicted departure at future stop =
  current time
  + expected remaining segment travel time
  + expected dwell time

predicted departure delay =
  predicted departure
  - scheduled departure
```

Where the realtime feed already supplies a credible downstream departure
prediction, that value should generally take precedence. Historical segment
and dwell estimates should fill gaps and validate whether the supplied
prediction is plausible.

### 4.5 Use vehicle blocks to predict cascading delay

A vehicle may complete its current trip below the 15-minute threshold but
still cause the next trip to start more than 15 minutes late when recovery
time is limited.

Use `block_id` and scheduled layover:

```text
predicted next-trip starting delay =
  predicted current-trip completion delay
  - available recovery or layover time
```

The interface should show both the current trip and any downstream trips at
risk.

### 4.6 Add explainable prediction confidence

Begin with a rules-based confidence score rather than a black-box model.

Confidence inputs could include:

- Age of the realtime feed
- Age of the vehicle position
- Number of future stop predictions
- Prediction uncertainty supplied by the feed
- Agreement between TripUpdate and VehiclePosition
- Agreement between reported speed and position movement
- Distance from the scheduled shape
- Prediction volatility across recent observations
- Missing or inconsistent trip identifiers
- Availability of historical segment data

Always show the explanation:

> Medium confidence: the feed is current, but the vehicle position is missing
> and the departure prediction changed by four minutes during the last two
> observations.

### 4.7 Avoid premature machine learning

The first prediction model should be transparent and measurable. Historical
medians and weighted recent averages grouped by route, direction, stop
segment, weekday, and time of day can provide substantial value.

Consider a learned model only after the system has accumulated enough clean
observation and outcome data to compare it against the explainable baseline.

## 5. On-demand service-quality prediction

### 5.1 Define wait time consistently

The operating policy must define the event that starts a customer's wait.
Possible anchors include:

- Customer ready time
- Requested pickup-window start
- Confirmed pickup-window start
- Trip request or booking time for immediate trips

Once defined:

```text
predicted wait time =
  predicted pickup time
  - wait-start time
```

Poor service occurs when the predicted or actual wait is more than 25 minutes.

### 5.2 Recommended on-demand inputs

- Wait-start time
- Requested or promised pickup time/window
- Current elapsed wait
- Assigned versus unassigned status
- Assigned vehicle
- Vehicle location and ETA
- Remaining pickups and drop-offs ahead of the customer
- Expected travel and service time for preceding stops
- Deadhead time
- Vehicle capacity
- Accessibility and vehicle requirements
- Driver availability, breaks, and pull-offs
- Cancellations and no-shows
- Zone-level demand
- Available vehicle supply by zone

### 5.3 Explainable initial calculation

```text
predicted pickup time =
  current time
  + travel time for remaining assigned work
  + expected dwell/service time
  + deadhead time to the customer

predicted total wait =
  predicted pickup time
  - wait-start time
```

### 5.4 Suggested on-demand exception states

- **Normal:** predicted wait of 20 minutes or less
- **Watch:** predicted wait above 20 but no more than 25 minutes
- **Predicted poor service:** predicted wait greater than 25 minutes
- **Poor service occurring:** actual wait greater than 25 minutes
- **Critical:** substantially beyond the standard, unassigned, or continuing
  to worsen
- **Recovering:** prediction has returned below the threshold

The 20-minute watch level is an early-warning band, not a new service-quality
standard.

### 5.5 Individual and system-wide communications

An individual delayed on-demand trip should support a private customer update
containing an updated pickup estimate.

A public zone-wide service alert should be suggested only when a broader
capacity or service problem affects a significant group of customers.

Public views and alert suggestions must not expose customer PII.

## 6. Proposed information architecture

```text
Control Center
|- Overview
|- Fixed Route
|- On-Demand
|- Alert Review
|- Active Communications
|- Service History
`- Administration
```

The existing OCC reference modules can remain accessible, but the exception
workflow should become the primary operating experience.

## 7. Control Center overview

The landing page should present immediate service-quality risk across both
systems.

```text
+-----------------------------------------------------------------------+
| SERVICE RISK                                       Updated 10 sec ago |
+----------------+----------------+----------------+-------------------+
| FIXED ROUTE    | ON-DEMAND      | NEEDS REVIEW   | ACTIVE ALERTS     |
| 3 predicted    | 7 predicted    | 5 suggestions  | 4 published       |
| >15 min late   | >25 min wait   | Oldest: 4 min  | 1 recovering      |
+----------------+----------------+----------------+-------------------+
| Immediate attention                                                   |
|                                                                       |
| [HIGH] Route 442 NB predicted 18 min late at Burnsville TC            |
|        Threshold in 9 min - Confidence: High            Review ->     |
|                                                                       |
| [HIGH] Connect trip 1842 predicted 31 min wait                        |
|        Currently 19 min - Unassigned - Zone 2           Review ->     |
|                                                                       |
| [MED]  Route 477 EB predicted 16 min late at Apple Valley TC          |
|        Delay recovering - Confidence: Medium            Monitor ->    |
+-----------------------------------------------------------------------+
```

Each summary metric should open the corresponding filtered exception list.

## 8. Fixed Route Service Risk workspace

Rename or evolve **Live Delays** into **Fixed Route Service Risk**. “Live
Delays” describes current conditions; the desired capability predicts future
departure performance.

### 8.1 Summary metrics

- Trips currently departing more than 15 minutes late
- Trips predicted to exceed 15 minutes
- Trips in the watch band
- Routes affected
- Predictions with low confidence
- Trips with missing or stale realtime data

### 8.2 Exceptions-first list

Show only trips needing attention by default:

| Route/trip | Vehicle | Current departure delay | Predicted maximum | First affected departure | Threshold ETA | Trend | Confidence |
| --- | --- | ---: | ---: | --- | ---: | --- | --- |
| 442 NB | 1732 | +9 min | **+18 min** | Burnsville TC, 4:42 | 9 min | Worsening | High |
| 477 EB | 1621 | +13 min | **+16 min** | Apple Valley TC, 5:07 | 14 min | Recovering | Medium |
| 495 SB | — | Unknown | Unknown | Realtime missing | — | — | Low |

Provide a separate **All monitored trips** view for fleet-wide diagnostics.

### 8.3 Terminology

Use:

- Departure delay
- Predicted departure
- First affected departure
- Departure threshold
- On-time departure performance
- Alert suggestion created

Avoid using generic “delay” when it is unclear whether the value represents an
arrival or departure.

### 8.4 Trip detail drawer

Selecting a trip should open its evidence without losing list context:

```text
Route 442 Northbound - Vehicle 1732

CURRENT
Departure delay              +9 min
Last reported                28 sec ago
Current location             South of Burnsville TC
Trip progress                In transit to stop

PREDICTION
Maximum predicted delay      +18 min
First departure >15 min      Burnsville TC, 4:42 PM
Threshold expected           In 9 minutes
Trend                        Worsening
Confidence                   High

WHY THIS WAS FLAGGED
[x] Delay increased in 3 consecutive observations
[x] Vehicle speed is below normal for this segment
[x] Only 3 minutes of scheduled recovery remain
[x] Realtime feed is current
[ ] Traffic data is not connected

DOWNSTREAM IMPACT
Next block trip              Route 442 NB at 5:05 PM
Predicted starting delay     +14 min

[Create alert] [Acknowledge] [Monitor] [Dismiss prediction]
```

### 8.5 Stop-by-stop departure timeline

```text
Stop                    Scheduled   Predicted   Departure variance
Cedar Grove              4:21 PM     4:30 PM      +9 min
Burnsville TC            4:42 PM     5:00 PM     +18 min  <- threshold
Apple Valley TC          5:01 PM     5:18 PM     +17 min
Route terminal           5:19 PM     5:34 PM     +15 min
```

This view allows a controller to verify where the model expects service
quality to fail.

## 9. On-Demand Service Quality workspace

On-demand monitoring should be a separate workspace because its operational
measure and intervention choices differ from fixed route.

### 9.1 Summary metrics

- Customers currently waiting more than 25 minutes
- Customers predicted to wait more than 25 minutes
- Unassigned trips in the watch band
- Median current wait
- 90th-percentile predicted wait
- Available vehicles by zone

### 9.2 Exceptions-first list

| Trip | Zone | Wait now | Predicted total wait | Assigned vehicle | Stops ahead | Threshold status | Confidence |
| --- | --- | ---: | ---: | --- | ---: | --- | --- |
| 1842 | 2 | 19 min | **31 min** | Unassigned | — | Crosses in 6 min | High |
| 1817 | 1 | 23 min | **28 min** | 604 | 2 | Crosses in 2 min | Medium |
| 1799 | 3 | 27 min | **29 min** | 611 | 1 | Already poor | High |

### 9.3 On-demand detail drawer

```text
Connect Trip 1842 - Zone 2

CUSTOMER WAIT
Wait began                   3:56 PM
Current wait                 19 min
Predicted pickup             4:27 PM
Predicted total wait         31 min
Service threshold            25 min
Threshold crossing           In 6 minutes

ASSIGNMENT
Vehicle                      Unassigned
Accessible vehicle required  Yes
Available vehicles in zone   1
Nearest eligible vehicle     12 minutes away

WHY THIS WAS FLAGGED
[x] Trip remains unassigned
[x] Zone demand exceeds available capacity
[x] Nearest eligible vehicle has one drop-off remaining
[x] Prediction worsened by 5 minutes

[Assign/escalate] [Prepare customer update] [Monitor] [Dismiss]
```

## 10. Alert Review experience

The transition from an operational exception to customer communication should
be short, transparent, and human-approved.

```text
Suggested communication

Reason
Route 442 northbound is predicted to exceed 15 minutes late.

Audience
[x] Route 442
[x] Northbound
[x] Affected stops after Burnsville TC

Channels
[x] Rider website
[x] SMS
[x] Email
[ ] Push
[ ] Digital signage

Suggested message
"Route 442 northbound is expected to experience delays of up to
18 minutes beginning near Burnsville Transit Station."

Expiration
(o) Predicted recovery time: 5:45 PM
( ) Custom

Evidence
Prediction confidence: High
Last updated: 28 seconds ago

[Approve and publish] [Edit] [Continue monitoring] [Dismiss]
```

Staff should always see:

- Why the alert was suggested
- Current and predicted conditions
- Confidence and evidence
- Who will receive it
- Which channels will be used
- When it will expire
- Whether a similar alert is already active

## 11. Active Communications and recovery

Publication should not end the workflow. Connect active messages to the
operational condition that created them.

Each alert should show:

- Current underlying condition
- Worsening, stable, or recovering trend
- Predicted recovery time
- Subscriber audience size
- SMS/email delivery success
- Last operational update
- Suggested next action

Example:

```text
Route 442 northbound delay

Published 4:31 PM - 286 recipients
Current prediction: +8 min and recovering
Original prediction: +18 min
Condition below threshold for 10 minutes

Suggested action: Expire alert
[Expire now] [Extend] [Send recovery update]
```

## 12. Interaction and visual design principles

### Exceptions first

Default to trips or customers requiring attention. Keep full-fleet data
available as a secondary diagnostic view.

### Evidence before automation

Every prediction should show:

- What is predicted
- When it is expected
- Confidence
- Data freshness
- Reasons
- Potential impact

### Progressive disclosure

Use summary metrics and concise rows for scanning. Open detailed evidence,
timelines, and raw telemetry only when a user selects an exception.

### Consistent severity

- **Red:** threshold already exceeded or immediate intervention required
- **Orange:** predicted threshold crossing
- **Yellow:** watch condition or uncertain data
- **Green:** recovering or within standard
- **Gray:** stale, missing, or insufficient data
- **Blue/purple:** workflow state, such as awaiting review

Do not rely on color alone. Include explicit labels such as “Predicted poor
service,” “Already above threshold,” and “Low confidence.”

### Useful ordering

Sort exceptions by:

1. Threshold already exceeded
2. Time until predicted threshold crossing
3. Confidence
4. Riders, trips, or downstream service affected
5. Age of the unreviewed exception

### Controlled notifications

Avoid constant alarms:

1. Add a silent watch item when risk first appears.
2. Raise a visible exception when the prediction persists.
3. Notify the controller when threshold crossing becomes likely.
4. Re-notify only when severity worsens materially, an urgent item remains
   unacknowledged, or service recovers.

Every exception should have a workflow state:

```text
New -> Acknowledged -> Alert prepared -> Published -> Recovering -> Closed
                              |
                              `-> Dismissed
```

## 13. OCC Decision Matrix and procedure governance

The Decision Matrix should evolve from a static reference module into a
digital operating-procedure system. Its purpose is to consolidate OCC
knowledge, make the correct response easier to find, and document how a
controller handled an event.

### 13.1 Procedure structure

Each procedure should contain:

- Condition or event type
- Observable criteria
- Severity level
- Immediate controller actions
- Required notifications
- Escalation contacts or roles
- Customer communication guidance
- Follow-up actions
- Required documentation
- Related policies and reference material
- Procedure owner
- Effective date and revision history

Example:

```text
Condition
Fixed-route departure predicted more than 15 minutes late

Criteria
- Prediction persists across two observations
- Confidence is medium or high
- No duplicate active incident exists

Controller actions
1. Verify CAD/AVL status and vehicle assignment.
2. Contact the operator or contractor when required.
3. Review downstream block impact.
4. Prepare a customer alert.
5. Record the selected response and outcome.

Escalate when
- Delay exceeds 30 minutes
- Multiple trips or routes are affected
- Accessible service is compromised
```

### 13.2 Decision support

When the monitoring system raises an exception, it should automatically
surface the relevant Decision Matrix procedure rather than requiring staff to
search manually.

The controller should be able to:

- Acknowledge the exception
- Open the recommended procedure
- Record completed actions
- Add notes
- Assign or transfer ownership
- Escalate to another role
- Prepare a customer communication
- Close the event with a resolution code

### 13.3 Governance and auditability

Procedures should be:

- Versioned
- Assigned to an owner
- Reviewed on a defined schedule
- Approved before publication
- Searchable by condition, route, mode, severity, and keyword
- Preserved historically when changed

Operational records should retain the exact procedure version that was shown
to the controller. This supports training, post-event review, consistency, and
defensible documentation.

### 13.4 Decision Matrix reporting

Useful reporting includes:

- Most frequently used procedures
- Events with no matching procedure
- Average acknowledgement and resolution time
- Steps most often skipped or marked not applicable
- Escalation frequency
- Differences in response between shifts or contractors
- Procedures that generate repeated manual work

The Decision Matrix should support staff judgment, not force a rigid response
when field conditions require a justified deviation.

## 14. OTP compliance and contractor scorecards

OTP Compliance should become a governed calculation and reporting capability
for contract oversight. It must preserve the raw operating record while
allowing approved exclusions for stops or extraordinary events.

### 14.1 Departure-based OTP

Because MVTA evaluates departures, OTP calculations should be based on the
scheduled and observed departure at the applicable timepoint:

```text
departure variance =
  observed departure
  - scheduled departure
```

The precise on-time window should be configurable by contract, service,
route, and reporting period rather than embedded in UI code.

### 14.2 Stop and timepoint filtering

Administrators should be able to define rules such as:

- Include only designated timepoints
- Exclude stops that are not valid OTP measurement locations
- Exclude terminal observations when required by the contract
- Apply route- or direction-specific measurement points
- Apply rules only during defined dates or service periods

Every rule should include an effective date, owner, reason, and approval
record.

### 14.3 Weather and extraordinary-event exclusions

The system should support governed exclusion events for:

- Severe weather
- Declared snow emergencies
- Major crashes or road closures
- Police or fire activity
- Approved detours
- Major special events
- System outages or verified bad telemetry

An exclusion should define:

- Reason code
- Description
- Start and end time
- Geographic scope
- Routes, directions, stops, zones, or contractors affected
- Supporting evidence or reference
- Requestor
- Approver
- Approval timestamp

Exclusions should never delete or overwrite the source observation.

### 14.4 Raw, adjusted, and excluded results

Reports should always preserve three views:

1. **Raw OTP:** all otherwise eligible observations before extraordinary-event
   exclusions.
2. **Adjusted OTP:** the contract-compliance result after approved exclusions.
3. **Excluded observations:** every removed record with its reason and
   approval trail.

Example:

```text
Contractor scorecard - July

Raw OTP                         84.7%
Approved exclusions             312 departures
Adjusted contract OTP           91.3%
Contract target                 90.0%

Primary exclusion reasons
- Severe weather                174
- Approved road closure          88
- Invalid measurement stop       50
```

This separation prevents exclusions from obscuring actual operating
conditions while still producing the contractually appropriate score.

### 14.5 Contractor scorecards

Scorecards could include:

- Raw and adjusted OTP
- Early departures
- Late departures
- Missed trips
- Canceled trips
- Data completeness
- Percentage of observations excluded
- Exclusions by reason
- Performance by route, direction, timepoint, day, and time of day
- Month-over-month trend
- Contract target and variance
- Corrective-action status

Users should be able to drill from any aggregate score to the underlying
departure observations and exclusion decisions.

### 14.6 Reporting controls

For defensible compliance reporting:

- Freeze completed reporting periods
- Require approval to reopen a period
- Preserve recalculation history
- Record the rule set and procedure version used
- Provide role-based access for editing exclusions
- Export the scorecard and supporting detail
- Flag unusually high exclusion rates
- Prevent the same observation from receiving conflicting exclusions

## 15. Speed-safety monitoring

Speed Alerts should help controllers investigate credible safety risks without
treating a single GPS reading as proof of speeding.

### 15.1 Validate the signal

A credible speed event should consider:

- Reported vehicle speed
- Speed calculated from consecutive positions
- GPS accuracy and timestamp freshness
- Persistence across multiple readings
- Distance traveled between readings
- Whether the vehicle is on its scheduled shape
- Road type and applicable speed limit when available
- Congestion context
- Vehicle status and route assignment

The system should suppress or lower confidence for:

- A single isolated spike
- Impossible acceleration
- A large disagreement between reported and calculated speed
- Stale or duplicate positions
- A position far from the scheduled route

### 15.2 Speed exception states

- **Unverified reading:** isolated or low-quality telemetry
- **Watch:** elevated speed requiring another observation
- **Credible speeding event:** persistent, validated exceedance
- **Critical:** substantial or continuing exceedance
- **Acknowledged:** controller has taken ownership
- **Resolved:** speed normalized or response completed

### 15.3 Controller experience

A speed event should show:

```text
Vehicle 1732 - Route 442 NB

Reported speed                 58 mph
Position-derived speed         56 mph
Reference speed                45 mph
Duration above threshold       72 sec
Readings above threshold       4
Location                       Cedar Ave southbound
Feed age                       18 sec
Confidence                     High

WHY THIS WAS FLAGGED
[x] Reported and calculated speed agree
[x] Exceedance persisted across 4 readings
[x] Vehicle remains on its scheduled route
[x] Position data is current

[Acknowledge] [Open procedure] [Monitor vehicle] [Dismiss telemetry]
```

The system should open the relevant Decision Matrix procedure and preserve the
controller's actions and outcome.

Speed monitoring should support safety response and documentation. It should
not automatically make a disciplinary determination.

### 15.4 Speed reporting

Useful measures include:

- Credible events by vehicle, route, contractor, and time
- Repeated events involving the same vehicle
- Average acknowledgement time
- Events dismissed as bad telemetry
- Locations with repeated validated exceedances
- Percentage of events with complete supporting data

## 16. Special-event vehicle monitoring

OCC should be able to create a temporary monitoring workspace for a special
event and select the vehicles or service to watch.

### 16.1 Event setup

An event definition should include:

- Event name and description
- Start and end time
- Venue or geographic area
- Routes and directions
- Selected vehicles
- Special-event trips or blocks
- Expected headways or departure plan
- Important stops or checkpoints
- Controller owner
- Notification and escalation rules

Vehicle selection should support:

- Individual vehicle IDs
- Route or block
- Contractor
- Saved vehicle groups
- Vehicles assigned after the event begins

### 16.2 Live event workspace

Show:

- Selected vehicle locations
- Scheduled and predicted departures
- Headway or spacing
- Vehicles missing from the feed
- Vehicles leaving the expected service area
- Extended dwell
- Bunching and service gaps
- Occupancy when reliable
- Current alerts and incidents
- Controller notes and acknowledgements

Example:

```text
Special Event: Summer Festival Shuttle
6:00 PM-11:30 PM - 8 vehicles monitored

SERVICE STATUS
Vehicles active                 7 of 8
Missing telemetry               Vehicle 608
Largest service gap             24 min
Vehicles bunched                604 and 611
Departure risks                 2

[Open live map] [Add vehicle] [Create incident] [Prepare alert]
```

### 16.3 Event-specific exceptions

The event workspace should detect:

- Vehicle has not entered service
- Vehicle telemetry is stale
- Vehicle left the event geofence or route
- Departure is predicted late
- Excessive headway or service gap
- Vehicle bunching
- Extended dwell
- Unexpected early departure
- Capacity or crowding concern

Thresholds should be configurable for the event rather than assumed to be the
same as regular service.

### 16.4 Post-event summary

Produce an event report containing:

- Planned versus operated service
- Departure performance
- Headway performance
- Vehicle availability
- Service gaps and bunching
- Alerts and incidents
- Customer communications
- Controller actions
- Data gaps
- Lessons and follow-up items

This turns the workspace into both a live monitoring tool and a repeatable
planning resource for future events.

## 17. Additional value-added capabilities

### 17.1 Route health

Show on-time, watch, predicted late, currently late, canceled, and missing-data
percentages by route and direction.

### 17.2 Headway and bunching detection

For frequent service, monitor actual spacing between vehicles. Flag bunching
and large gaps even when individual trips appear close to schedule.

### 17.3 Cancellation and missed-trip detection

Distinguish missing realtime information from a trip that likely did not enter
service. Never label a missing TripUpdate as on time.

### 17.4 Feed-quality monitoring

Detect:

- Stale feeds
- Missing trips
- Repeated timestamps
- Impossible position jumps
- Invalid coordinates
- Vehicles far from their scheduled shape
- Disagreement between reported speed and position movement
- Conflicting trip and vehicle identifiers

### 17.5 Live operations map

Plot vehicles against scheduled shapes and color them by service risk. Show
next departure, predicted threshold crossing, and confidence.

### 17.6 Alert-impact scoring

Prioritize suggested alerts using:

- Number of routes and trips affected
- Number of stops affected
- Duration
- Severity
- Occupancy
- Number of matching subscribers
- Downstream vehicle-block impact
- Zone-wide on-demand demand and capacity

### 17.7 Historical replay

Allow staff to review a previous operating period and see:

- When conditions began changing
- What the system predicted
- When an exception was raised
- When staff acknowledged it
- When an alert was published
- How service recovered

### 17.8 Rider preference improvements

Allow riders to select:

- Routes
- Directions
- Stops
- On-demand zones
- Alert categories
- Minimum severity
- Delivery channels
- Travel windows
- Quiet hours

### 17.9 Accessibility and multilingual communication

Support plain-language and accessible alert variants, with future
multilingual options, while preserving staff approval.

### 17.10 External context

Later phases could correlate predictions with:

- MnDOT traffic conditions and incidents
- Severe weather
- Major events
- Road closures
- Known detours

External context should improve confidence and explanation, not automatically
publish an alert.

## 18. Performance measures

The prediction system should be evaluated using operational outcomes:

- Percentage of fixed-route departures over 15 minutes detected in advance
- Percentage of on-demand waits over 25 minutes detected in advance
- Median advance warning
- False-positive rate
- Missed-event rate
- Staff approval and dismissal rates
- Time from detection to staff acknowledgement
- Time from detection to customer notification
- Departure prediction error at 5-, 10-, and 20-minute horizons
- On-demand pickup prediction error
- Prediction accuracy by route, direction, stop, zone, and time of day
- Percentage of customer notifications successfully delivered
- Time from service recovery to alert closure
- Percentage of OCC exceptions linked to a Decision Matrix procedure
- Procedure acknowledgement and completion time
- Raw and adjusted OTP by contractor
- Exclusion rate and exclusions by reason
- Percentage of OTP results traceable to supporting observations
- Credible speeding events and telemetry-dismissal rate
- Speed-event acknowledgement time
- Special-event planned versus operated service
- Special-event headway and departure performance

The system should report both overall performance and performance by segment
so that weak routes, zones, time periods, or data sources are visible.

## 19. Suggested implementation sequence

### Phase 1 — Correct and structure the current data

1. Change TripUpdate processing to prefer departures.
2. Import `stop_times.txt`, service calendars, shapes, and vehicle blocks.
3. Process every future StopTimeUpdate.
4. Store scheduled and predicted arrival and departure separately.
5. Add an append-only observation history.
6. Correct GTFS alert deduplication to include feed type and service instance.

### Phase 2 — Deliver explainable fixed-route prediction

1. Calculate downstream predicted departures.
2. Identify the first departure projected above 15 minutes.
3. Calculate worsening, stable, and recovering trends.
4. Add confidence and data-freshness explanations.
5. Predict downstream vehicle-block effects.
6. Measure prediction outcomes.

### Phase 3 — Redesign the operational workflow

1. Add the Control Center overview.
2. Evolve Live Delays into Fixed Route Service Risk.
3. Separate exception and full-fleet views.
4. Add the trip detail drawer.
5. Add the stop-by-stop departure timeline.
6. Connect predictions to prefilled Suggested Alerts.
7. Add active-alert recovery recommendations.
8. Link exceptions to versioned Decision Matrix procedures.

### Phase 4 — Add on-demand service-quality monitoring

1. Define the authoritative wait-start event.
2. Integrate on-demand trip, assignment, manifest, and vehicle data.
3. Calculate current and predicted wait.
4. Add the 20-minute watch state and 25-minute poor-service threshold.
5. Create individual customer-update and zone-wide alert workflows.
6. Measure pickup prediction accuracy and service-standard compliance.

### Phase 5 — Expand intelligence and context

1. Add route health and headway/bunching detection.
2. Add feed-quality monitoring.
3. Build governed OTP exclusions and contractor scorecards.
4. Strengthen Speed Alerts with persistence and telemetry validation.
5. Add special-event vehicle watchlists and event workspaces.
6. Add the operations map.
7. Integrate traffic, weather, and event context.
8. Evaluate learned models against the explainable baseline.
9. Add historical replay and performance reporting.

## 20. Recommended first deliverable

The first improvement should be an explainable fixed-route departure
prediction:

1. Import scheduled stop departure times.
2. Retain every realtime stop departure prediction.
3. Store observation history.
4. Calculate the predicted departure delay at every remaining stop.
5. Identify the first stop projected above 15 minutes.
6. Display trend, confidence, feed freshness, and supporting evidence.
7. Prepare—but do not automatically publish—a Suggested Alert.

This deliverable would move the application from reporting a current delay to
providing the control center with advance warning of a likely service-quality
failure.
