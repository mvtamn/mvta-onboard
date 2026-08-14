// Shared domain types. These mirror the REST API contract in
// functions-restapi/src/functions/* and the SQL schema in
// functions-restapi/sql/phase1-schema.sql. Keep them in sync with the backend.

export const CATEGORIES = [
  "delay",
  "detour",
  "closure",
  "outage",
  "general",
  "emergency",
  "demand_response_delay",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["informational", "minor", "major", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EXPIRATION_SOURCES = ["explicit", "inferred_text", "category_default"] as const;
export type ExpirationSource = (typeof EXPIRATION_SOURCES)[number];

// Shape returned by GET /messages/active (messagesActive.js).
export interface ActiveMessage {
  message_id: string;
  summary: string;
  category: Category;
  severity: Severity;
  routes_affected: string[];
  stops_affected: string[];
  zones_affected: string[];
  channels: string[];
  expires_at: string;
  created_at: string;
}

// Request body for POST /messages (messagesCreate.js / validation.js).
export interface CreateMessageInput {
  raw_text: string;
  summary?: string;
  category: Category;
  severity: Severity;
  routes_affected?: string[];
  stops_affected?: string[];
  zones_affected?: string[];
  tags?: string[];
  channels?: string[];
  // Never send this for a human caller - the server always derives it from
  // the verified auth principal (see functions-restapi/src/functions/
  // messagesCreate.ts). Optional only for a future System.Ingestion caller.
  created_by?: string;
  expires_at: string;
  expiration_source: ExpirationSource;
}

export interface CreateMessageResult {
  message_id: string;
  created_at: string;
  expires_at: string;
}

// Request body for POST /subscribers (rider opt-in). "ALL" is a valid value
// for routes/zones per the schema, meaning "every route"/"every zone".
export interface SubscribeInput {
  phone_number?: string;
  email?: string;
  routes?: string[] | "ALL";
  zones?: string[] | "ALL";
  categories: Category[];
  consent_source: "web_form" | "mobile_app";
}

// Staff-console admin surfaces (Audit Log, Admin, Subscribers, Suggested Alerts).

export type MessageStatus = "active" | "expired" | "archived" | "retracted";

export interface AdminMessage {
  message_id: string;
  summary: string;
  category: Category;
  severity: Severity;
  tags: string[];
  routes_affected: string[];
  channels: string[];
  status: MessageStatus;
  created_by: string;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

export interface ExpirationDefault {
  category: Category;
  default_ttl_minutes: number;
  updated_by: string | null;
  updated_at: string;
}

export interface SubscribersSummary {
  total: number;
  sms_confirmed: number;
  email_confirmed: number;
  pending: number;
  opted_out: number;
}

export interface MaskedSubscriber {
  subscriber_id: string;
  phone_masked: string | null;
  email_masked: string | null;
  status: string;
  email_status: string | null;
  opted_in_at: string | null;
}

export type SuggestedAlertStatus = "pending" | "approved" | "dismissed" | "expired";

export interface SuggestedAlert {
  alert_id: string;
  source: "gtfs_rt" | "zona" | "missed_trip";
  draft_text: string;
  category: Category;
  severity: Severity;
  routes_affected: string[];
  zones_affected: string[];
  detail: Record<string, unknown> | null;
  status: SuggestedAlertStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  message_id: string | null;
}

export interface PrepareSuggestedAlertInput {
  source: "gtfs_rt" | "zona" | "missed_trip";
  external_id: string;
  draft_text: string;
  category: Category;
  severity: Severity;
  routes_affected?: string[];
  zones_affected?: string[];
  detail: Record<string, unknown>;
}

export interface PrepareSuggestedAlertResult {
  alert_id: string;
  status: SuggestedAlertStatus;
  created: boolean;
}

export type ProcedureTrustState =
  | "Approved"
  | "Preview"
  | "Needs review"
  | "Stale"
  | "Partial"
  | "Unavailable"
  | "Retired";

export interface DecisionMatrixProcedure {
  procedure_id: string;
  revision: number;
  condition_key: string;
  condition: string;
  criteria: string;
  severity: string;
  severity_meaning: string | null;
  immediate_actions: string[];
  escalation_triggers: string[];
  notifications: string[];
  communication_guidance: string | null;
  required_documentation: string | null;
  tags: string[];
  service_mode: string | null;
  affected_workflow: string | null;
  urgency: string | null;
  document_type: "SOP" | "REF";
  document_code: string;
  source_url: string | null;
  source_revision: string | null;
  owner: string | null;
  approver: string | null;
  approval_state: "Preview" | "Approved" | "Retired";
  trust_state: ProcedureTrustState;
  effective_at: string | null;
  next_review_at: string | null;
  retired_at: string | null;
  source_status: "available" | "partial" | "unavailable";
  last_synced_at: string | null;
  updated_at: string;
}

export interface DecisionMatrixDiagnostics {
  table_ready: boolean;
  source: string;
  include_history?: boolean;
}

export interface DecisionMatrixCandidate extends Pick<DecisionMatrixProcedure, "procedure_id" | "revision" | "condition" | "condition_key" | "criteria" | "severity" | "severity_meaning" | "immediate_actions" | "tags" | "document_type" | "document_code" | "source_url" | "trust_state"> {
  match_reason: string;
}

export interface TripDelay {
  trip_id: string;
  route_id: string;
  service_date: string | null;
  vehicle_id: string | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  previous_stop_id: string | null;
  previous_stop_name: string | null;
  direction_label: string | null;
  delay_seconds: number;
  predicted_max_departure_delay_seconds: number | null;
  first_threshold_stop_id: string | null;
  first_threshold_stop_name: string | null;
  first_threshold_departure_at: string | null;
  departure_predictions: DeparturePrediction[];
  prediction_confidence: "high" | "medium" | "low" | null;
  prediction_reasons: string[];
  prediction_updated_at: string | null;
  polls_over_threshold: number;
  first_seen_at: string;
  last_polled_at: string;
  suggested_alert_id: string | null;
  latitude: number | null;
  longitude: number | null;
  bearing: number | null;
  speed_mps: number | null;
  occupancy_status: number | null;
  current_status: number | null;
  position_updated_at: string | null;
}

export type TripDelayDataState =
  | "current"
  | "no_current_trips"
  | "stale"
  | "configuration_missing";

export interface TripDelayDiagnostics {
  state: TripDelayDataState;
  trip_updates_configured: boolean;
  vehicle_positions_configured: boolean;
  static_gtfs_configured: boolean;
  active_trip_count: number;
  threshold_risk_count: number;
  last_trip_update_at: string | null;
  route_reference_count: number;
  static_stop_count: number;
  direction_reference_count: number;
  stale_after_minutes: number;
}

export interface DeparturePrediction {
  stop_sequence: number;
  stop_id: string | null;
  departure_delay_seconds: number;
  predicted_departure_at: string | null;
}

// The authoritative route registry (GtfsRoutes) - backs Compose's affected-
// routes multi-select.
export interface GtfsRouteOption {
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_sort_order: number | null;
}

export type MissedTripStatus = "watching" | "escalated" | "resolved";
export type MissedTripValidationStatus = "unreviewed" | "confirmed" | "false_positive";
export type MissedTripDataQualityStatus = "legacy_unverified" | "source_verified" | "experimental";
export type MissedTripSourceSystem = "gtfs" | "spare";

// Missed Trips is a compliance/investigation tool, not a customer-alert
// queue - detection only flags a candidate here; a staff member investigates
// and records the outcome via POST /missed-trips/validate. Preparing a rider
// notice (if warranted) stays a separate, explicit action through the normal
// suggested-alerts prepare/focus flow.
// detection_type/reason_code added by migration-023 - before that migration
// runs, existing rows read back as null for both; the console shows an
// honest "Unknown - flagged before detection tracking was added" rather
// than guessing.
export type MissedTripDetectionType =
  | "explicit_cancellation"
  | "silent_no_show"
  | "spare_late_start"
  | "spare_superseded"
  | "spare_late_arrival"
  | "spare_multiple";

export interface MissedTrip {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: string;
  grace_deadline_at: string;
  status: MissedTripStatus;
  detection_type: MissedTripDetectionType | null;
  detected_late_arrival_at: string | null;
  suggested_alert_id: string | null;
  first_seen_watching_at: string;
  last_checked_at: string;
  validation_status: MissedTripValidationStatus;
  reason_code: string | null;
  validated_by: string | null;
  validated_at: string | null;
  notes: string | null;
  detector_version: string | null;
  data_quality_status: MissedTripDataQualityStatus;
  source_system: MissedTripSourceSystem;
  source_record_id: string | null;
  condition_late_start: boolean | null;
  condition_superseded: boolean | null;
  condition_late_arrival: boolean | null;
  start_delay_seconds: number | null;
  arrival_delay_seconds: number | null;
  // NB/SB/EB/WB from GtfsTripDirections, same convention as TripDelay.direction_label -
  // null when the trip isn't in that reference table or no direction could be determined.
  direction_label: string | null;
}

export interface ValidateMissedTripInput {
  trip_id: string;
  service_date: string;
  validation_status: "confirmed" | "false_positive";
  notes?: string;
  reason_code: string;
}

export interface MissedTripReview {
  review_id: number;
  previous_validation_status: MissedTripValidationStatus;
  validation_status: Exclude<MissedTripValidationStatus, "unreviewed">;
  reason_code: string;
  notes: string | null;
  reviewed_by: string;
  reviewed_at: string;
}

export interface MissedTripsDiagnostics {
  configured: boolean;
  view: "queue" | "history" | "all";
  limit: number;
  offset: number;
  returned_count: number;
  view_count: number;
  total_count: number;
  active_count: number;
  resolved_count: number;
  unreviewed_count: number;
  legacy_unverified_count: number;
  last_checked_at: string | null;
  silent_no_show_enabled: boolean;
  schedule_detection_status: "paused" | "experimental";
  spare_enabled: boolean;
  spare_service_scope_configured: boolean;
  feed_health: Array<{
    feed_name: string;
    last_success_at: string | null;
    last_entity_count: number | null;
    source_timestamp_at: string | null;
    status: "current" | "stale";
  }>;
}

// GET /missed-trips-monthly-summary - one row per (month, route, detection
// type, outcome) combination; the console pivots this into a table.
export interface MissedTripsMonthlySummaryRow {
  service_month: string;
  route_id: string;
  source_system: MissedTripSourceSystem;
  detection_type: MissedTripDetectionType | null;
  validation_status: MissedTripValidationStatus;
  trip_count: number;
}

export interface MissedTripsMonthlySummaryResponse {
  summary: MissedTripsMonthlySummaryRow[];
}

export interface OnDemandRiskRecord {
  trip_id: string;
  external_trip_id: string | null;
  zone_id: string;
  wait_started_at: string;
  predicted_pickup_at: string | null;
  current_wait_minutes: number;
  predicted_wait_minutes: number | null;
  assigned_vehicle_id: string | null;
  stops_ahead: number | null;
  accessible_vehicle_required: boolean;
  eligible_vehicles_in_zone: number | null;
  nearest_vehicle_context: string | null;
  trend: "worsening" | "stable" | "recovering";
  prediction_confidence: "high" | "medium" | "low" | null;
  prediction_reasons: string[];
  source_updated_at: string | null;
  last_polled_at: string;
  suggested_alert_id: string | null;
}

// GTFS-Realtime standard enums (raw ints from VehiclePosition, translated
// client-side - same convention as CATEGORY_LABELS/SEVERITY_LABELS below).
export const OCCUPANCY_LABELS: Record<number, string> = {
  0: "Empty",
  1: "Many seats available",
  2: "Few seats available",
  3: "Standing room only",
  4: "Crushed standing room",
  5: "Full",
  6: "Not accepting passengers",
};

export const CURRENT_STATUS_LABELS: Record<number, string> = {
  0: "Approaching stop",
  1: "Stopped at stop",
  2: "En route",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  delay: "Delay",
  detour: "Detour",
  closure: "Closure",
  outage: "Outage",
  general: "General",
  emergency: "Emergency",
  demand_response_delay: "MVTA Connect Delay",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  informational: "Informational",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};

// Avail's own proprietary AVL Reports API - a separate vehicle-location
// source from the GTFS-Realtime feeds (distinct vehicle_id/route/block/run/
// trip keys, no guaranteed join to a GTFS trip_id). Backs Event Monitoring's
// live vehicle positions.
export interface AvailAvlVehicle {
  vehicle_id: number;
  route: number | null;
  block: number | null;
  run: number | null;
  trip: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  operator_name: string | null;
  operator_source: string | null;
  speed_mph: number | null;
  report_timestamp: string;
  updated_at: string;
}

// Avail's Pullout Reports API - garage-side departure compliance (check-in/
// login/pullout timing, scheduled vs actual). A growing historical log, not
// a live-position feed - backs the Fixed Route Departures Compliance module.
export interface FixedRouteDeparture {
  service_date: string;
  block: number;
  run: number;
  checkin_scheduled: string | null;
  checkin_actual: string | null;
  login_scheduled: string | null;
  login_actual: string | null;
  pullout_scheduled: string | null;
  pullout_actual: string | null;
  pullout_status: string | null;
  operator_name: string | null;
  logon_id: number | null;
  vehicle_label: string | null;
  updated_at: string;
  pullout_delta_seconds: number | null;
}

// Avail's OTP Monthly By Route/Stop/Day of Week feed - real Attachment G
// departure-adherence numbers, backing the OTP Compliance module's Route
// Summary/Review Queue/Monthly Assessments pages (replacing that module's
// mock data). See OTP-Feed-Evaluation-and-Recommendation.md.
export interface OtpMonthlyStopRow {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  stop_name: string | null;
  route_label: string | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_not_ontime: number | null;
  pct_missed: number | null;
  early: number | null;
  ontime: number | null;
  late: number | null;
  missed: number | null;
  actual_departures: number | null;
  total: number | null;
  updated_at: string;
}

export interface OtpMonthlyRouteRollup {
  route_id: number;
  route_label: string | null;
  total: number;
  ontime: number;
  pct_ontime: number | null;
}

// Sub-monthly OTP trending (OtpDailyRouteStopHour) - added per
// OTP-Feed-Evaluation-and-Recommendation (3).md's 2026-08-05 live-data
// investigation update. Never the official Attachment G number - that's
// OtpMonthlyStopRow above. No UI reads this yet; the field mapping itself
// is unconfirmed (see functions-restapi/src/lib/otpDailyFeed.ts).
export interface OtpDailyRow {
  calendar_date: string;
  hour_of_day: number;
  route_id: number;
  stop_id: number;
  stop_name: string | null;
  route_label: string | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_not_ontime: number | null;
  pct_missed: number | null;
  early: number | null;
  ontime: number | null;
  late: number | null;
  missed: number | null;
  actual_departures: number | null;
  total: number | null;
  latitude: number | null;
  longitude: number | null;
  direction: string | null;
  updated_at: string;
}

// Avail's Missed Trips By Route/Stop/Day feed - vendor-reported fixed-route
// missed-trip incidents for Attachment G compliance. Distinct from
// MissedTrip above (real-time GTFS-based no-show/cancellation detection) -
// this is Avail's own contractually-scoped compliance data source, surfaced
// in the OTP Compliance module's Monthly Assessments page.
export interface AvailMissedTripRecord {
  service_month: string;
  calendar_date: string;
  route_id: number;
  route_desc: string | null;
  route_internet_name: string | null;
  departure_stop_id: number | null;
  departure_stop_name: string | null;
  arrival_stop_id: number | null;
  arrival_stop_name: string | null;
  departure_missed: boolean;
  arrival_missed: boolean;
  entire_trip_missed: boolean;
  departure_trip_start_time: string | null;
  ingested_at: string;
}

export interface AvailMissedTripsRouteRollup {
  route_id: number;
  route_desc: string | null;
  incident_count: number;
  entire_trip_missed_count: number;
}

// Detour & Closure module - see detour-and-event-module-implementation-plan.md.
// Status is computed server-side (functions-restapi/src/lib/detourStatus.ts)
// and never stored - one shared definition, not duplicated client-side.
export type DetourStatus = "monitor" | "upcoming" | "active" | "recently_finished" | "expired";
export type DetourFulfillmentMode = "avail" | "fixed_route_manual" | "mobility_manual";
export type DetourLifecycleState =
  | "approved" | "awaiting_fulfillment" | "fulfilled" | "fulfillment_failed" | "closed";

export const DETOUR_LIFECYCLE_LABELS: Record<DetourLifecycleState, string> = {
  approved: "Approved",
  awaiting_fulfillment: "Awaiting fulfillment",
  fulfilled: "Fulfilled",
  fulfillment_failed: "Fulfillment failed",
  closed: "Closed",
};

export const DETOUR_STATUS_LABELS: Record<DetourStatus, string> = {
  monitor: "Monitor",
  upcoming: "Upcoming",
  active: "Active",
  recently_finished: "Recently finished",
  expired: "Expired",
};

export interface DetourSegment {
  id: string;
  detour_id: string;
  routes: string;
  directions: string | null;
  sort_order: number;
}

// Draft 3-tier scale (Part B6) - confirm against MVTA's real practice.
export type DetourSeverity = "minor" | "moderate" | "major";

export const DETOUR_SEVERITY_LABELS: Record<DetourSeverity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
};

// Admin-editable reason categories - Part B6. Mirrors OtpReasonCode minus
// `applies_to`; this vocabulary only ever serves the detour module.
export interface DetourReasonCode {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
}

// Reporting fields (Part B6). Every one is optional on the wire and
// undefined - not null - on rows read before migration-025 has run, so the
// console can tell "not recorded" from "migration not applied" and hide the
// whole section in the latter case.
export interface DetourReportFields {
  reason_code?: string | null;
  severity?: DetourSeverity | null;
  reported_by?: string | null;
  reported_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  radio_notified?: boolean;
  dispatch_board_notified?: boolean;
  social_media_notified?: boolean;
  resolution_notes?: string | null;
}

export interface Detour extends DetourReportFields {
  id: string;
  number: string | null;
  // System-generated internal reference (MVTA-DET-YYYY-####, Part B10).
  // Distinct from `number`, which is staff-entered free text. Optional
  // because it is absent until migration-024 has run, and null on rows
  // created before that point.
  internal_number?: string | null;
  closure: string;
  start_date: string | null;
  end_date: string | null;
  is_monitor_only: boolean;
  riders_directed: string | null;
  email_sent: boolean;
  expired_email_sent: boolean;
  spare_emailed: boolean;
  source: "manual" | "avail";
  external_detour_id: string | null;
  last_edited_manually: boolean;
  avail_last_seen_at: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  status: DetourStatus;
  fulfillment_mode?: DetourFulfillmentMode;
  lifecycle_state?: DetourLifecycleState;
  workflow_owner?: string | null;
  workflow_updated_by?: string | null;
  workflow_updated_at?: string | null;
  avail_build_confirmed_at?: string | null;
  segments: DetourSegment[];
}

export interface DetourSegmentInput {
  routes: string;
  directions?: string | null;
  sort_order?: number;
}

export interface CreateDetourInput extends DetourReportFields {
  number?: string | null;
  closure: string;
  start_date?: string | null;
  end_date?: string | null;
  is_monitor_only?: boolean;
  riders_directed?: string | null;
  email_sent?: boolean;
  expired_email_sent?: boolean;
  spare_emailed?: boolean;
  segments?: DetourSegmentInput[];
  fulfillment_mode?: DetourFulfillmentMode;
  lifecycle_state?: DetourLifecycleState;
}

export type DetourIntakeStatus = "pending_review" | "accepted" | "rejected" | "duplicate";
export interface DetourIntake {
  id: string;
  detection_source: string;
  description: string;
  location: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  status: DetourIntakeStatus;
  decision_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promoted_detour_id: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface CreateDetourIntakeInput {
  detection_source: string;
  description: string;
  location?: string | null;
  proposed_start_date?: string | null;
  proposed_end_date?: string | null;
  segments?: DetourSegmentInput[];
}

export type UpdateDetourInput = Partial<CreateDetourInput>;

// Detour image attachments - Part B3 of detour-and-event-module-
// implementation-plan.md. Images never pass through the API directly -
// upload/read both go through short-lived SAS URLs.
export interface DetourImage {
  id: string;
  detour_id: string;
  blob_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  caption: string | null;
  sort_order: number;
  uploaded_by: string;
  uploaded_at: string;
  read_url: string | null;
}

export type DetourWorkflowHistoryEventType =
  | "created"
  | "state_transition"
  | "source_observation"
  | "manual_correction"
  | "fulfillment_confirmation";

export interface DetourWorkflowHistoryEntry {
  id: string;
  detour_id: string;
  event_type: DetourWorkflowHistoryEventType;
  from_state: DetourLifecycleState | null;
  to_state: DetourLifecycleState | null;
  source: "manual" | "avail" | null;
  detail: string | null;
  changed_by: string;
  changed_at: string;
}

// Route Classification - see detour-and-event-module-implementation-plan.md
// (Part A). No Avail feed distinguishes fixed-route from special-event
// RouteIDs, so this is the one place MVTA OnBoard itself decides.
export type RouteCategory = "FixedRoute" | "SpecialEvent" | "OnDemand";

export interface RouteClassificationRow {
  route_id: number;
  route_category: RouteCategory;
  route_label: string | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_at: string;
}

// A RouteID seen in live AVL data with no RouteClassification row yet -
// neither AVL Reports nor RouteClassification itself has any way to
// discover what needs classifying otherwise (AVL Reports carries only a
// bare numeric RouteID, no name). suggested_label is best-effort, pulled
// from OTP Monthly/Missed Trips when that route happens to have generated
// schedule-adherence data - null (not a guess) otherwise.
export interface UnclassifiedRoute {
  route_id: number;
  suggested_label: string | null;
}

export interface RouteClassificationListResponse {
  routes: RouteClassificationRow[];
  unclassified: UnclassifiedRoute[];
}

export interface RouteClassificationInput {
  route_category: RouteCategory;
  route_label?: string | null;
  effective_start_date?: string | null;
  effective_end_date?: string | null;
  is_active?: boolean;
  expected_updated_at?: string;
}

export const ROUTE_CATEGORY_LABELS: Record<RouteCategory, string> = {
  FixedRoute: "Fixed route",
  SpecialEvent: "Special event",
  OnDemand: "On-demand",
};

export interface AppSettingRow {
  module: string;
  setting_key: string;
  setting_value: string;
  value_type: "int" | "string" | "bool" | "decimal";
  min_value: string | null;
  max_value: string | null;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

// Event-bus live positions - filtered from Avail AVL Reports by
// RouteClassification (SpecialEvent routes only). Backs Event Monitoring's
// "Event bus positions (live)" panel. See detour-and-event-module-
// implementation-plan.md (Part A3).
// route_label/route_category are joined from RouteClassification server-side:
// an event RouteID is absent from GTFS static (and so from GTFS-RT), so
// getRoutes()/GtfsRouteOption can never name one - the classification row is
// the only source of a friendly name for a special-service route.
export interface EventVehiclePosition {
  vehicle_id: number;
  route: number | null;
  route_label: string | null;
  route_category: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  block: number | null;
  run: number | null;
  operator_name: string | null;
  service_plan_names: string[];
  service_plan_ids: string[];
  speed_mph: number | null;
  report_timestamp: string;
  updated_at: string;
  report_age_seconds: number;
  is_stale: boolean;
  is_in_active_scope: boolean;
}

export type EventHealthStatus = "healthy" | "degraded" | "failed" | "unknown";
export interface EventHealthComponent {
  component: string;
  status: EventHealthStatus;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  detail: string | null;
  updated_at: string;
}
export interface EventMonitoringHealth {
  components: EventHealthComponent[];
  maintenance: { last_started_at: string | null; last_success_at: string | null; last_error: string | null; last_positions_deleted: number; last_diagnostics_deleted: number } | null;
  event_id?: string;
  counts: { history_count: number; diagnostic_count: number; pending_notifications: number; active_vehicle_count: number; diagnostic_vehicle_count: number; pending_assignment_count: number; crossing_count: number };
}

export type EventLocationCategory = "transit_station" | "venue" | "park_and_ride" | "other";
export interface EventLocation { id: string; name: string; category: EventLocationCategory; latitude: number; longitude: number; notes: string | null; is_active: boolean; }
export interface EventGeofence { id: string; name: string; polygon: string; is_active: boolean; updated_by: string | null; updated_at: string; rules?: EventGeofenceRule[]; }
export interface EventGeofenceRule { id: string; geofence_id: string; transition: "enter" | "exit"; heading_min: number; heading_max: number; destination_label: string; destination_location_id: string | null; send_mode: "manual" | "auto"; sort_order: number; }
export interface EventGeofenceCrossing { id: number; vehicle_id: number; geofence_id: string; geofence_name: string; event_id?: string | null; service_plan_id?: string | null; transition: "enter" | "exit"; heading_at_crossing: number | null; destination_label: string | null; matched_rule_id?: string | null; matched_rule_priority?: number | null; matched_destination_location_id?: string | null; matched_send_mode?: "manual" | "auto" | null; crossed_at: string; }
export interface EventGeofenceNotification { id: string; crossing_id: number; send_mode: "manual" | "auto"; message_body: string; status: "pending" | "acknowledged" | "sent" | "dismissed" | "failed" | "expired"; sent_by: string | null; sent_at: string | null; acknowledged_by?: string | null; acknowledged_at?: string | null; created_at: string; attempt_count: number; last_error: string | null; next_attempt_at: string | null; }
export interface EventServicePlanRevision { id: string; service_plan_id: string; status: "draft" | "review" | "approved" | "applied" | "rejected"; created_by?: string; created_at?: string; }
export interface Event { id: string; name: string; description: string | null; owning_team: string | null; created_by: string; created_at: string; updated_by: string | null; updated_at: string; }
export interface EventServicePlan { id: string; event_id: string; name: string; status: "draft" | "review" | "approved" | "active" | "completed" | "suspended"; start_date: string | null; end_date: string | null; start_at: string | null; end_at: string | null; created_by: string; created_at: string; updated_by: string | null; updated_at: string; links?: { kind: "routes" | "geofences" | "locations"; service_plan_id: string; value: string | number; label: string }[]; revisions?: EventServicePlanRevision[]; published_scope?: { routes: { route_id: number; route_label: string | null; route_category: string; is_active: boolean }[]; geofences: (EventGeofence & { rules: EventGeofenceRule[] })[]; locations: EventLocation[] } | null; }
export interface EventAuditEntry { event_type: string; entity_id: string; detail: string; actor: string | null; event_at: string; }
export interface EventVehicleAssignment { id: string; event_id: string; service_plan_id: string; revision_id: string | null; vehicle_id: number; route_id: number; status: "proposed" | "accepted" | "applied" | "rejected"; reason: string | null; requested_by: string; requested_at: string; reviewed_by: string | null; reviewed_at: string | null; event_name?: string; service_plan_name?: string; }

// OTP Compliance completion - persisted exclusions, reason codes, threshold
// setting. Replaces the module's former ephemeral candidate/date-exclusion
// state and hardcoded reason-code arrays.
export type StopExclusionStatus = "approved" | "rejected";

export interface OtpStopExclusion {
  id: string;
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  status: StopExclusionStatus;
  reason_code: string | null;
  reviewed_by: string;
  reviewed_at: string;
}

export interface PutStopExclusionInput {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  status: StopExclusionStatus;
  reason_code?: string | null;
}

export type DateExclusionScope = "Agency" | "Route";
export type DateExclusionStatus = "Proposed" | "Approved";

export interface OtpDateExclusion {
  id: string;
  scope: DateExclusionScope;
  route_id: number | null;
  service_date: string;
  reason_code: string;
  notes: string | null;
  status: DateExclusionStatus;
  notified: boolean;
  notified_at: string | null;
  acknowledged: boolean;
  created_by: string;
  created_at: string;
}

export interface CreateDateExclusionInput {
  scope: DateExclusionScope;
  route_id?: number | null;
  service_date: string;
  reason_code: string;
  notes?: string | null;
}

export interface OtpAuditEntry {
  type: "stop_exclusion" | "date_exclusion";
  title: string;
  desc: string;
  timestamp: string;
}

// "missed_trip" added by migration-023 - the same admin-editable table now
// also backs Missed Trips' investigation-outcome dropdown.
export type ReasonCodeAppliesTo = "stop" | "date" | "missed_trip";

export interface OtpReasonCode {
  id: string;
  code: string;
  label: string;
  applies_to: ReasonCodeAppliesTo;
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
}

export interface CreateReasonCodeInput {
  code: string;
  label: string;
  applies_to: ReasonCodeAppliesTo;
}

export interface UpdateReasonCodeInput {
  label?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface OtpSettingsRow {
  early_late_bias_threshold: number;
  updated_by: string | null;
  updated_at: string | null;
}

export interface OtpMonthlyTrendPoint {
  service_month: string;
  total: number;
  ontime: number;
  pct_ontime: number | null;
}

// POST /otp-historical-backfill - fills one month outside the daily
// pollers' 3-month trailing window (e.g. Jan-May 2026, before this feed's
// poller existed). "And beyond" (future months) needs no backfill - the
// trailing window already rolls forward on its own. ONE month per
// request, not a range - CONFIRMED live 2026-08-06: a 5-month range in a
// single request hit a 504 gateway timeout. The console loops one request
// per month (see OtpModule.tsx's OtpHistoricalBackfillPanel) instead.
export interface OtpHistoricalBackfillInput {
  month: string; // YYYYMM
}

export interface OtpHistoricalBackfillResponse {
  service_month: string;
  otp_monthly: { reports_seen: number; upserted: number; error?: string };
  missed_trips: { reports_seen: number; rows_inserted: number; error?: string };
}

// GET /maps/token - short-lived Azure AD token scoped to Azure Maps, for
// the console's azure-maps-control SDK ('anonymous' auth mode). client_id
// is a public identifier (Azure Maps account's uniqueId), not a secret.
export interface MapsTokenResponse {
  client_id: string;
  access_token: string;
  expires_on: number;
}

export type AssessmentPeriodStatus = "open" | "in_review" | "in_validation" | "stale" | "finalized" | "issued" | "reopened";
export type AssessmentTierLabel = "meets" | "warning" | "tier1" | "tier2";
export type ManagerAssessmentAction = "pending" | "confirmed" | "adjusted" | "waived";

export interface ContractorPerformanceStandard {
  id: string; code: string; name: string; standard_type: "occurrence" | "threshold";
  priority: "High" | "Medium" | "Low" | "NA"; is_scored: boolean; unit_label: string;
  measurement_source?: "auto" | "manual"; responsible_team?: string | null; assigned_to?: string | null;
}

export interface ContractorRecord { id: string; name: string; contract_start_date: string; contract_end_date: string | null; is_active: boolean }
export interface AssessmentPeriod { id: string; contractor_id: string; contractor_name: string; service_month: string; status: AssessmentPeriodStatus; input_revision: number; computed_revision: number | null; proposed_total: number; final_total: number | null }
export interface PeriodKpiAssessment { id: string; period_id: string; standard_id: string; code: string; name: string; standard_type: string; priority: string; metric_display: string; target_display?: string; variance_pct?: number | null; tier_label: AssessmentTierLabel; occurrence_count: number; base_amount?: number; relief_amount?: number; escalation_multiplier?: number; proposed_amount: number; final_amount: number | null; manager_action: ManagerAssessmentAction; manager_reason: string | null; recommended_action?: Exclude<ManagerAssessmentAction,"pending"> | null; recommended_amount?: number | null; cap_required?: boolean; cap_reason?: string | null; consecutive_months_below?: number; data_completeness_pct: number | null }
export interface ComplianceOccurrence { id: string; standard_id: string; standard_code: string; standard_name: string; contractor_id: string; contractor_name: string; service_date: string; quantity: number; description: string; source: string; review_status: string; attribution: string }
export interface ManualMetricEntry { id: string; standard_id: string; standard_code: string; standard_name: string; contractor_id: string; contractor_name: string; service_month: string; metric_value: number; source_note: string; entered_by: string; entered_at: string }
export interface ContractorStandardTier { id: string; standard_id: string; tier_order: number; tier_label: AssessmentTierLabel; bound_low: number | null; bound_high: number | null; penalty_basis: string; penalty_amount: number; triggers_cap: boolean; notes: string | null }
export interface AssessmentReport { id: string; period_id: string; issuance_type: "preliminary" | "final"; version: number; content_sha256: string; issued_at: string | null; dispute_deadline_at: string | null }
export interface AssessmentCap { id: string; standard_name: string; status: string; trigger_reason: string; due_at: string }
export interface AssessmentDispute { id: string; report_version: number; item_count: number; basis: string; status: string; outcome: string | null; submitted_at: string }
export interface AssessmentEvidence { id: string; assessment_id: string; content_type: string; file_size_bytes: number; caption: string | null; content_sha256: string; visibility: "internal" | "contractor"; redaction_reason: string | null; uploaded_by: string; uploaded_at: string }
