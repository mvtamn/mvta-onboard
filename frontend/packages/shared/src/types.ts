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

// Missed Trips is a compliance/investigation tool, not a customer-alert
// queue - detection only flags a candidate here; a staff member investigates
// and records the outcome via POST /missed-trips/validate. Preparing a rider
// notice (if warranted) stays a separate, explicit action through the normal
// suggested-alerts prepare/focus flow.
export interface MissedTrip {
  trip_id: string;
  service_date: string;
  route_id: string;
  scheduled_departure_at: string;
  grace_deadline_at: string;
  status: MissedTripStatus;
  detected_late_arrival_at: string | null;
  suggested_alert_id: string | null;
  first_seen_watching_at: string;
  last_checked_at: string;
  validation_status: MissedTripValidationStatus;
  validated_by: string | null;
  validated_at: string | null;
  notes: string | null;
}

export interface ValidateMissedTripInput {
  trip_id: string;
  service_date: string;
  validation_status: "confirmed" | "false_positive";
  notes?: string;
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
