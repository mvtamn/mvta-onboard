// Validates input against the same rules as the database CHECK constraints
// (sql/phase1-schema.sql), so bad input fails fast with a clear 400 error
// instead of an opaque SQL constraint violation.
import {
  VALID_CATEGORIES,
  VALID_SEVERITIES,
  VALID_EXPIRATION_SOURCES,
  VALID_CONSENT_SOURCES,
} from "./types";

// Match the NVARCHAR column sizes in sql/phase1-schema.sql so oversized input
// fails fast with a clear 400 here instead of an opaque SQL truncation 500.
export const MAX_SUMMARY_LENGTH = 500; // Messages.summary  NVARCHAR(500)
export const MAX_CREATED_BY_LENGTH = 200; // Messages.created_by NVARCHAR(200)

// Bodies arrive as parsed JSON of unknown shape — validation is the boundary
// that proves the shape, so fields are checked as unknowns here.
type UnknownBody = Record<string, unknown>;

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

export function validateCreateMessage(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (!body.raw_text || typeof body.raw_text !== "string" || body.raw_text.trim() === "") {
    errors.push("raw_text is required and must be a non-empty string");
  }
  if (!includes(VALID_CATEGORIES, body.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!includes(VALID_SEVERITIES, body.severity)) {
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(", ")}`);
  }
  if (
    !body.expires_at ||
    typeof body.expires_at !== "string" ||
    isNaN(Date.parse(body.expires_at))
  ) {
    errors.push("expires_at is required and must be a valid ISO 8601 timestamp");
  }
  if (!includes(VALID_EXPIRATION_SOURCES, body.expiration_source)) {
    errors.push(`expiration_source must be one of: ${VALID_EXPIRATION_SOURCES.join(", ")}`);
  }
  if (!body.created_by || typeof body.created_by !== "string") {
    errors.push(
      "created_by is required (staff identifier, or 'delay_detection' / 'wait_time_monitor' for system-generated messages)",
    );
  } else if (body.created_by.length > MAX_CREATED_BY_LENGTH) {
    errors.push(`created_by must be at most ${MAX_CREATED_BY_LENGTH} characters`);
  }

  // summary is optional (messagesCreate derives one from raw_text when absent),
  // but if the caller supplies one it must fit the column.
  if (body.summary !== undefined && body.summary !== null) {
    if (typeof body.summary !== "string") {
      errors.push("summary must be a string if provided");
    } else if (body.summary.length > MAX_SUMMARY_LENGTH) {
      errors.push(`summary must be at most ${MAX_SUMMARY_LENGTH} characters`);
    }
  }

  for (const field of ["routes_affected", "stops_affected", "zones_affected", "tags", "channels"]) {
    const v = body[field];
    if (v !== undefined && v !== null && !Array.isArray(v)) {
      errors.push(`${field} must be an array if provided`);
    }
  }

  return errors;
}

// E.164: leading +, then 8-15 digits. Matches the Subscribers.phone_number
// NVARCHAR(20) column, which is documented as E.164 format.
const E164_RE = /^\+[1-9]\d{7,14}$/;
// Deliberately permissive email shape check - real deliverability is proven by
// the double opt-in confirmation, not by regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubscribe(body: UnknownBody): string[] {
  const errors: string[] = [];

  const hasPhone =
    body.phone_number !== undefined && body.phone_number !== null && body.phone_number !== "";
  const hasEmail = body.email !== undefined && body.email !== null && body.email !== "";

  if (!hasPhone && !hasEmail) {
    errors.push("At least one of phone_number or email is required");
  }
  if (hasPhone && (typeof body.phone_number !== "string" || !E164_RE.test(body.phone_number))) {
    errors.push("phone_number must be E.164 format, e.g. +16125550142");
  }
  if (
    hasEmail &&
    (typeof body.email !== "string" || body.email.length > 320 || !EMAIL_RE.test(body.email))
  ) {
    errors.push("email must be a valid email address");
  }

  if (!Array.isArray(body.categories) || body.categories.length === 0) {
    errors.push("categories must be a non-empty array");
  } else {
    const bad = body.categories.filter((c) => !includes(VALID_CATEGORIES, c));
    if (bad.length > 0) {
      errors.push(`categories contains invalid values: ${bad.join(", ")}`);
    }
  }

  if (!includes(VALID_CONSENT_SOURCES, body.consent_source)) {
    errors.push(`consent_source must be one of: ${VALID_CONSENT_SOURCES.join(", ")}`);
  }

  for (const field of ["routes", "zones"]) {
    const v = body[field];
    if (v !== undefined && v !== null && v !== "ALL" && !Array.isArray(v)) {
      errors.push(`${field} must be an array or the string "ALL" if provided`);
    }
  }

  return errors;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: unknown): value is string {
  return typeof value === "string" && GUID_RE.test(value);
}

// PATCH /messages/{id} - partial edit; at least one editable field required.
export function validateUpdateMessage(body: UnknownBody): string[] {
  const errors: string[] = [];
  const hasSummary = body.summary !== undefined;
  const hasExpires = body.expires_at !== undefined;

  if (!hasSummary && !hasExpires) {
    errors.push("At least one of summary or expires_at must be provided");
  }
  if (hasSummary) {
    if (typeof body.summary !== "string" || body.summary.trim() === "") {
      errors.push("summary must be a non-empty string if provided");
    } else if (body.summary.length > MAX_SUMMARY_LENGTH) {
      errors.push(`summary must be at most ${MAX_SUMMARY_LENGTH} characters`);
    }
  }
  if (hasExpires && (typeof body.expires_at !== "string" || isNaN(Date.parse(body.expires_at)))) {
    errors.push("expires_at must be a valid ISO 8601 timestamp if provided");
  }
  return errors;
}

// PATCH /admin/expiration-defaults/{category}
// TTL bounds: 5 minutes to 30 days - matches the operational range of the
// seeded defaults (120 min .. 1440 min) with generous headroom.
export const MIN_TTL_MINUTES = 5;
export const MAX_TTL_MINUTES = 43200;

export function validateExpirationDefault(body: UnknownBody): string[] {
  const errors: string[] = [];
  const ttl = body.default_ttl_minutes;
  if (typeof ttl !== "number" || !Number.isInteger(ttl)) {
    errors.push("default_ttl_minutes is required and must be an integer");
  } else if (ttl < MIN_TTL_MINUTES || ttl > MAX_TTL_MINUTES) {
    errors.push(`default_ttl_minutes must be between ${MIN_TTL_MINUTES} and ${MAX_TTL_MINUTES}`);
  }
  return errors;
}

export { VALID_CATEGORIES, VALID_SEVERITIES, VALID_EXPIRATION_SOURCES, VALID_CONSENT_SOURCES };
