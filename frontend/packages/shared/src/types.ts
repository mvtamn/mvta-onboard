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

export type SuggestedAlertStatus = "pending" | "approved" | "dismissed";

export interface SuggestedAlert {
  alert_id: string;
  source: "gtfs_rt" | "zona";
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

export const CATEGORY_LABELS: Record<Category, string> = {
  delay: "Delay",
  detour: "Detour",
  closure: "Closure",
  outage: "Outage",
  general: "General",
  emergency: "Emergency",
  demand_response_delay: "Zona Delay",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  informational: "Informational",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};
