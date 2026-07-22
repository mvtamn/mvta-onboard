// API domain types. These mirror frontend/packages/shared/src/types.ts —
// the apps deploy as standalone npm projects, so the types are kept in sync by
// hand for now (true single-source sharing needs a root workspace restructure,
// deferred to avoid disturbing the live deployment layout).

export const VALID_CATEGORIES = [
  "delay",
  "detour",
  "closure",
  "outage",
  "general",
  "emergency",
  "demand_response_delay",
] as const;
export type Category = (typeof VALID_CATEGORIES)[number];

export const VALID_SEVERITIES = ["informational", "minor", "major", "critical"] as const;
export type Severity = (typeof VALID_SEVERITIES)[number];

export const VALID_EXPIRATION_SOURCES = ["explicit", "inferred_text", "category_default"] as const;
export type ExpirationSource = (typeof VALID_EXPIRATION_SOURCES)[number];

export const VALID_CONSENT_SOURCES = ["web_form", "mobile_app"] as const;
export type ConsentSource = (typeof VALID_CONSENT_SOURCES)[number];

export interface CreateMessageBody {
  raw_text: string;
  summary?: string | null;
  category: Category;
  severity: Severity;
  routes_affected?: string[] | null;
  stops_affected?: string[] | null;
  zones_affected?: string[] | null;
  tags?: string[] | null;
  channels?: string[] | null;
  created_by: string;
  expires_at: string;
  expiration_source: ExpirationSource;
}

export interface SubscribeBody {
  phone_number?: string | null;
  email?: string | null;
  routes?: string[] | "ALL" | null;
  zones?: string[] | "ALL" | null;
  categories: Category[];
  consent_source: ConsentSource;
}

export interface MessageCreatedEvent {
  message_id: string;
  category: Category;
  severity: Severity;
  summary: string;
  routes_affected: string[] | null;
  zones_affected: string[] | null;
  channels: string[] | null;
  created_at: string | Date;
  expires_at: string | Date;
}

export interface ConfirmationRequestedEvent {
  confirmation_id: string;
  subscriber_id: string;
  channel: "sms" | "email";
  token: string;
  phone_number: string | null;
  email: string | null;
}
