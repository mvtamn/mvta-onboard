# Missed Trips — Feature Finish Plan

Date: 2026-08-07

Inputs:

- `plans/missed-trip-detection-logic-gaps.md`
- `plans/onboard-spare-integration-spec.md`
- Direct Avail `MissedTripsByRouteStopDay` sample for 2026-07-29
- Current GTFS/Avail backend and Missed Trips console implementation

## Scope boundary

This plan delivers **Missed Trips only**.

In scope:

- fixed-route missed-trip candidate detection and validation;
- Avail missed-trip reconciliation;
- Spare Ridership Export + Slots fields needed specifically for Spare missed-trip conditions;
- the shared Missed Trips API, review workflow, audit trail, reporting, and UI/UX.

Explicitly deferred to their own feature work:

- ridership counters;
- mean wait time;
- garage-departure metrics, delay-reason entry, and garage-departure UI;
- general Spare dashboards, Duties ingestion, Stops reference ingestion, and route/timetable views,
  unless a concrete missed-trip condition later proves one of them is strictly required;
- event-bus tracking, detours, OTP, or other compliance modules.

Do not build these deferred features as prerequisites or side effects of finishing Missed Trips.

## Outcome

Finish Missed Trips as one review experience backed by separate, honest source pipelines:

1. **Fixed route, live operations:** static GTFS + GTFS-RT TripUpdate + VehiclePosition produce
   candidates, with feed health and evidence attached.
2. **Fixed route, retrospective vendor data:** Avail Missed Trips provides reconciliation and
   aggregate compliance evidence after its field/filter semantics are validated.
3. **Spare service:** Spare Ridership Export + Slots produce request-level candidates from actual
   pickup/dropoff/cancellation events and the same-duty supersession rule.
4. **Human review:** a shared candidate/incident workflow records confirmation, false positive,
   attribution, evidence, notes, and audit history without pretending the sources have identical
   identifiers or certainty.

Do not merge all raw data into `MonitoredMissedTrips`. Normalize source results into a new shared
review model while preserving source-specific raw tables and identifiers.

## Phase 0 — Contain false positives now

This is the first release. Do it before further UI polish or compliance reporting.

1. Add a feature flag such as `GTFS_SILENT_NO_SHOW_ENABLED=false` and disable schedule-absence
   escalation in production. Keep explicit GTFS-RT `CANCELED` ingestion enabled.
2. Add a visible system banner: "Schedule-based no-show detection paused while timing and start
   evidence are being corrected." Do not call the resulting queue "live and connected" without
   also reporting detector/feed health.
3. Stop promoting current GTFS candidates into monthly assessments or contractor assessment.
   Existing rows were produced with incorrect UTC/local comparisons and cannot be bulk-assumed
   valid.
4. Snapshot existing rows for audit, then mark them `legacy_unreliable` or exclude them by a
   detector-version cutoff. Do not mass-label them false positive; their truth is unknown.
5. Change production API failures from preview fixtures to a hard error/empty state showing last
   successful refresh. Preview data may remain only behind an explicit development flag.

Exit gate:

- No new silent-no-show candidates are created by the known-bad detector.
- An API/database outage can never appear to staff as plausible sample trip data.
- Current compliance totals exclude legacy/unvalidated candidates.

## Phase 1 — Define the decision contract

Approve one written rule set before rebuilding ingestion.

### Shared outcome states

- `candidate`: evidence suggests a miss; awaiting review.
- `unknown_data_gap`: the decision window lacked healthy source coverage.
- `confirmed_missed`: reviewer confirmed the occurrence and attribution.
- `false_positive`: reviewer rejected the candidate.
- `operated_within_window`: positive start evidence at/before the deadline.
- `started_late`: positive start evidence after the deadline; still a miss under the 30-minute
  definition.
- `vendor_reported_unmatched`: retrospective vendor incident that cannot be matched to an
  individual live candidate.

Keep machine state separate from human outcome. "Resolved" must not mean both "the bus appeared"
and "this was not a missed trip."

### Decisions requiring owner/OCC sign-off

1. Exact boundary: `> 30 minutes` versus `>= 30 minutes`, separately for start and arrival.
2. Whether the compliance clock uses original or subsequently rescheduled pickup/start time.
3. Which cancellation faults/reasons count as contractor-attributable. Never count every Spare
   cancellation automatically.
4. Spare condition 2: final same-duty supersession definition, including behavior when actual
   pickup is null.
5. Whether Avail arrival-only misses are part of this feature or a separate missed-stop measure.
6. Whether fixed route and Spare incidents share one KPI or remain separate metrics that can be
   rolled up later.

Exit gate: examples for every outcome and edge case are approved and become test fixtures.

## Phase 2 — Build a shared evidence/review model

Create source-neutral review tables; retain existing source tables during migration.

### `MissedTripCandidates`

Minimum fields:

- `candidate_id` UUID primary key
- `source` (`gtfs_rt`, `avail`, `spare`)
- `service_mode` (`fixed_route`, `spare_on_demand`, other confirmed modes)
- `source_record_id` nullable; unique only within a source
- `service_date` agency-local date
- `route_or_service_id`, `trip_or_request_id`, `duty_id`, `vehicle_id` nullable
- scheduled/original-scheduled and actual-evidence timestamps as UTC instants
- `deadline_at`, `decision_state`, `detection_condition`, `confidence`
- `detector_version`, `calculation_version`
- `feed_health_state`, `first_detected_at`, `last_evaluated_at`
- source-specific evidence JSON for traceability

Use a source-scoped uniqueness key. Avail rows without incident IDs/start times may not be safely
deduplicated and may remain aggregate/unmatched records.

### `MissedTripReviews`

Append-only review events:

- reviewer, timestamp, outcome, attribution, reason code, notes
- previous and new values
- correction/reopen event support

Do not overwrite the only copy of a review as the current `UPDATE MonitoredMissedTrips` endpoint
does. Derive the latest review state from the audit events or maintain a current projection.

### `FeedPollRuns`

Persist per-source poll start/end, requested window, success/failure, entity count, source refresh
time, and coverage/freshness. Absence can only create a no-show candidate when the relevant feed
was healthy through the decision window.

Exit gate: API can return a candidate with its source, condition, confidence, evidence, feed
health, detector version, and review history.

## Phase 3 — Correct fixed-route live detection

1. Convert static GTFS service-day times from `America/Chicago` to UTC instants using a real
   timezone implementation. Preserve GTFS times greater than `24:00:00`; test CST, CDT, spring
   forward, fall back, and midnight rollover.
2. Extend static ingestion to retain first stop ID/sequence and `block_id` where available.
3. Record raw TripUpdate observations independently of the delay mapper. A TripUpdate with no
   usable delay must not disappear from observation diagnostics.
4. Record VehiclePosition observations independently of `MonitoredTripDelays`; the current poller
   discards positions when no delay row exists.
5. Derive `actual_start_at` only from positive underway evidence, such as progression past the
   first stop or a validated position/status transition. Feed presence alone is not start proof.
6. At deadline, emit `unknown_data_gap` when coverage was stale; never turn a feed outage into a
   silent no-show.
7. Retain immediate explicit cancellation, but attach the source record and feed timestamp.
8. Add replayable pure-function tests for the decision state machine before re-enabling the
   production feature flag.

Exit gate:

- A known scheduled trip cannot be flagged five hours early.
- A future TripUpdate cannot resolve or start a trip merely by existing.
- A feed outage produces `unknown_data_gap`, not `candidate`.
- Replay against at least several real service days reaches an agreed precision target before
  live escalation is enabled. Start with at least 95% reviewer precision for high-confidence
  candidates; report recall separately rather than hiding unknowns.

## Phase 4 — Repair and validate Avail reconciliation

1. Fix `DepartureTripStartTime`: combine `CalendarDate` + `HH:mm` in `America/Chicago`, or store
   raw local time/minutes separately. `new Date("14:31")` currently turns every populated time
   into null.
2. Run the same-date filter matrix `/0/0`, `/0/1`, `/1/0`, `/1/1` and document actual effects on
   total rows, Route 999/deadheads, and flag combinations.
3. Obtain Avail definitions for `DepartureMissed`, `ArrivalMissed`, `EntireTripMissed`, and both
   filter parameters. The direct sample contradicts the assumed meanings.
4. Preserve apparent duplicate multiplicity unless Avail confirms it is erroneous. Null-time rows
   cannot be safely deduplicated using visible fields.
5. Measure publication lag using response refresh metadata and first ingestion time.
6. Reconcile to fixed-route candidates with explicit match quality: `exact`, `probable`,
   `unmatched`. Never force a trip-level join when Avail omitted identifying fields.
7. Exclude deadheads and non-fixed routes using validated semantics plus `RouteClassification`,
   not a single unverified endpoint flag.

Exit gate: a one-day and one-month reconciliation report explains every included/excluded Avail
row and quantifies unmatched records.

## Phase 5 — Implement Spare as its own detection pipeline

Use `plans/onboard-spare-integration-spec.md`, with the following changes before implementation.

### Confirm the integration contract

1. Confirm Ridership Export date filters, pagination, rate limits, maximum range, publication lag,
   and incremental-sync behavior.
2. Confirm API-key server-to-server authentication is supported for every needed endpoint. Do not
   build OAuth Authorization Code into timer jobs unless refresh-token/scopes requirements make it
   necessary.
3. Confirm Slots pagination and the full `type` enum, especially pickup and `startLocation`.
4. Confirm timestamp formats/offsets and derive `service_date` in `America/Chicago`.
5. Confirm which Spare services are in scope for Missed Trips and how `serviceId` identifies them.

### Tighten the three conditions

1. **Late start/no-show/cancelled:** use `pickupLatenessSeconds` or positive pickup lifecycle
   evidence. For cancellations, evaluate `cancellationFault` and `cancellationReason`; rider- or
   agency-approved cancellations must not automatically become contractor missed trips.
2. **Superseded on same duty:** use Slots scoped to `dutyId`, but explicitly handle null
   `pickupArrivedTime`, cancelled next slots, breaks/end-location slots, and equal/overlapping
   schedules. Make this a tested state transition, not one SQL comparison.
3. **Late arrival:** use `dropoffLatenessSeconds` only after the exact boundary and applicability
   rules are approved.
4. Decide original versus current scheduled times and store both in the evidence. Never overwrite
   away the basis used for a prior calculation.
5. Do not add garage-departure variance to this build. It can be linked as optional root-cause
   evidence later without changing the missed-trip decision contract.

### Build order

1. Raw Ridership Export ingestion with run diagnostics and idempotent upsert.
2. Raw Slots ingestion.
3. Pure evaluation function with versioned fixtures.
4. Candidate projection into `MissedTripCandidates`.
5. Project reviewed/validated output into Missed Trips reporting.

Do not implement Spare ridership counters, wait-time metrics, Duties/garage metrics, or their UI
as part of this phase.

Exit gate: replay a historical Spare window and review a stratified sample of all three conditions,
cancellations by fault, non-misses, and unknown/missing data with OCC.

## Phase 6 — Replace the Missed Trips UI/UX

### Information architecture

Use four views:

1. **Review queue:** unreviewed candidates only by default.
2. **Confirmed incidents:** confirmed missed trips with attribution and evidence.
3. **History:** false positives, operated-within-window, unknown/data-gap, and corrected reviews.
4. **Data quality:** feed freshness, failed polls, unmatched Avail rows, detector versions, and
   source coverage.

Monthly reporting should be a reporting view over confirmed incidents, not raw detector rows.

### Queue behavior

- Default sort: high confidence, deadline/age, then source priority.
- Filters: date range, route/service, source, service mode, condition, confidence, decision state,
  review status, and feed-health state.
- Server-side filtering and pagination; `GET /missed-trips` must not return all historical rows.
- Keep the selected row in the table and open a side drawer; do not switch layouts when a table
  row is clicked.
- Add guarded bulk false-positive action only for a shared documented reason/detector version.
  Never bulk-confirm penalties.

### Candidate detail

Show:

- scheduled and actual/evidence times with `Central` timezone label and full date on hover/detail;
- source and service mode;
- plain-language condition: "No positive start evidence by 14:31 Central";
- evidence timeline (schedule, feed observations, deadline, vendor reconciliation);
- feed health during the decision window;
- confidence and why;
- detector/calculation version;
- same-duty Slot evidence where condition 2 applies;
- review history and correction/reopen control.

Require an outcome-appropriate reason. False-positive reasons should describe detection/data
failure; confirmed reasons should describe operational cause/attribution. Do not mix both into one
undifferentiated dropdown.

### Fix current misleading behavior

- Remove automatic production fallback to `MISSED_TRIP_ALERTS` preview fixtures.
- Do not label the API simply "connected"; show last successful poll and source health.
- Do not hide all `resolved` rows without giving staff a history view.
- Do not count reviewed confirmed/false-positive rows as items still needing investigation.
- Use `service_date`, not the currently incorrect `scheduled_departure_at`, for month bucketing.
- Monthly totals must default to confirmed, attributable incidents and show candidate/unknown
  counts separately.
- Render service dates as readable local dates instead of raw `YYYYMMDD`.
- Wire the existing aging/overdue concept into the visible queue only after candidate validity is
  restored; aging badges on a false-positive flood merely add noise.

Exit gate: five OCC reviewers can complete representative review tasks without needing raw trip
IDs or external timestamp conversion, and no error/preview state can be mistaken for live data.

## Phase 7 — Controlled rollout

1. Run the corrected fixed-route detector in shadow mode for at least one representative service
   week; create no staff queue items automatically.
2. Compare high/medium/low-confidence candidates with dispatch evidence and Avail reconciliation.
3. Run Spare historical replay and OCC sampling separately.
4. Publish precision, unknown-data rate, unmatched-vendor rate, and review burden by source.
5. Enable high-confidence candidates first. Keep medium confidence in a secondary triage view.
6. Promote confirmed incidents to contractor assessment only after human attribution.
7. Version every rule change and retain the evidence used for past decisions.

## Recommended execution order

1. False-positive containment and removal of production preview fallback.
2. Decision contract and source-neutral schema.
3. Correct fixed-route time/evidence pipeline with shadow replay.
4. Avail parser/filter validation and reconciliation.
5. Spare Ridership Export + Slots proof of integration, then historical evaluator.
6. New review UI/API with pagination, evidence, feed health, and audit history.
7. Controlled source-by-source activation and contractor-assessment handoff.

Do not start with the monthly dashboard. Until detection validity and review semantics are fixed, a
more polished aggregate only makes unreliable numbers look authoritative.

## Implementation status (2026-08-07)

Implemented in the current worktree:

- GTFS silent no-show defaults paused via `GTFS_SILENT_NO_SHOW_ENABLED=false`; explicit
  cancellations remain active.
- Removed TripUpdate-first-observation auto-resolution.
- Correct agency-local (`America/Chicago`) service-date/time conversion, including GTFS
  `>24:00:00` times and CST/CDT.
- Static schedule now retains first stop ID/sequence and block ID.
- TripUpdate and VehiclePosition operational evidence is stored independently; only positive
  progress beyond the first stop establishes `first_underway_at`.
- Experimental silent candidates can resolve only from positive underway evidence within their
  deadline; late evidence remains a missed candidate.
- Avail `DepartureTripStartTime` (`HH:mm`) parsing now combines with `CalendarDate` in agency time.
- Existing detector rows are tagged legacy/unverified; new rows carry detector/data-quality
  metadata.
- Review writes now require a reason and append to review history rather than leaving only an
  overwritten current value.
- API has queue/history views, bounded pagination, feed health, and safety diagnostics.
- UI has Review Queue/History/Monthly views, no production sample-data fallback on API failure,
  visible paused/stale-feed warnings, evidence quality/version, required reasons, review history,
  and load-more behavior.
- Monthly summary uses agency `service_date` and source-verified rows; confirmation promotes a
  manually verified row into that reporting set.
- Spare-only Missed Trips source/Slots/evaluation schema and a versioned three-condition evaluator
  are implemented. Evaluation is disabled by default pending live export ingestion confirmation;
  unattributed cancellations and missing supersession evidence become `unknown_data_gap`, not
  false candidates.

Required deployment order:

1. Apply migrations 026, 027, and 028.
2. Deploy backend and frontend together.
3. Set `GTFS_SILENT_NO_SHOW_ENABLED=false` explicitly in the Function App.
4. Leave `SPARE_MISSED_TRIPS_ENABLED=false` until Ridership Export/Slots ingestion is populated and
   `SPARE_CONTRACTOR_FAULT_VALUES` is approved.
5. Run the daily static GTFS sync once after migration 027 so first-stop/block fields are populated.
6. Verify TripUpdate and VehiclePosition feed-health rows and operational evidence in shadow mode.

Verification completed locally:

- backend TypeScript build passes;
- all 209 backend tests pass;
- full frontend production build passes.
