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
  // created_by is optional here: for a human caller the server always derives
  // it from the verified auth principal (messagesCreate.ts), never from the
  // body. It's only consulted as a System.Ingestion fallback label (e.g.
  // 'delay_detection'), so if present it just needs to be a reasonable string.
  if (body.created_by !== undefined && body.created_by !== null) {
    if (typeof body.created_by !== "string") {
      errors.push("created_by must be a string if provided");
    } else if (body.created_by.length > MAX_CREATED_BY_LENGTH) {
      errors.push(`created_by must be at most ${MAX_CREATED_BY_LENGTH} characters`);
    }
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

export function validatePrepareSuggestedAlert(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (body.source !== "gtfs_rt" && body.source !== "zona" && body.source !== "missed_trip") {
    errors.push("source must be gtfs_rt, zona, or missed_trip");
  }
  if (
    typeof body.external_id !== "string" ||
    body.external_id.trim() === "" ||
    body.external_id.length > 100
  ) {
    errors.push("external_id is required and must be at most 100 characters");
  }
  if (typeof body.draft_text !== "string" || body.draft_text.trim() === "") {
    errors.push("draft_text is required and must be a non-empty string");
  }
  if (!includes(VALID_CATEGORIES, body.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!includes(VALID_SEVERITIES, body.severity)) {
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(", ")}`);
  }
  for (const field of ["routes_affected", "zones_affected"]) {
    const value = body[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      errors.push(`${field} must be an array of strings if provided`);
    }
  }
  if (
    body.detail === null ||
    typeof body.detail !== "object" ||
    Array.isArray(body.detail)
  ) {
    errors.push("detail is required and must be an object");
  }

  return errors;
}

// E.164: leading +, then 8-15 digits. Matches the Subscribers.phone_number
// NVARCHAR(20) column, which is documented as E.164 format.
const E164_RE = /^\+[1-9]\d{7,14}$/;
// Deliberately permissive email shape check - real deliverability is proven by
// the double opt-in confirmation, not by regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_MISSED_TRIP_VALIDATION_STATUSES = ["confirmed", "false_positive"] as const;
export const MAX_MISSED_TRIP_NOTES_LENGTH = 1000; // MonitoredMissedTrips.notes NVARCHAR(1000)

export const MAX_DRAFT_RAW_TEXT_LENGTH = 4000; // generous ceiling on what gets sent to the Claude API

export function validateDraftSummary(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (
    typeof body.raw_text !== "string" ||
    body.raw_text.trim() === "" ||
    body.raw_text.length > MAX_DRAFT_RAW_TEXT_LENGTH
  ) {
    errors.push(`raw_text is required and must be at most ${MAX_DRAFT_RAW_TEXT_LENGTH} characters`);
  }
  if (!includes(VALID_CATEGORIES, body.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!includes(VALID_SEVERITIES, body.severity)) {
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(", ")}`);
  }

  return errors;
}

export function validateMissedTripValidation(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (typeof body.trip_id !== "string" || body.trip_id.trim() === "") {
    errors.push("trip_id is required and must be a non-empty string");
  }
  if (typeof body.service_date !== "string" || body.service_date.trim() === "") {
    errors.push("service_date is required and must be a non-empty string");
  }
  if (!includes(VALID_MISSED_TRIP_VALIDATION_STATUSES, body.validation_status)) {
    errors.push(
      `validation_status must be one of: ${VALID_MISSED_TRIP_VALIDATION_STATUSES.join(", ")}`,
    );
  }
  if (
    body.notes !== undefined &&
    body.notes !== null &&
    (typeof body.notes !== "string" || body.notes.length > MAX_MISSED_TRIP_NOTES_LENGTH)
  ) {
    errors.push(`notes must be a string of at most ${MAX_MISSED_TRIP_NOTES_LENGTH} characters if provided`);
  }
  if (body.reason_code !== undefined && body.reason_code !== null) {
    if (typeof body.reason_code !== "string" || body.reason_code.length > MAX_REASON_CODE_LENGTH) {
      errors.push(`reason_code must be a string of at most ${MAX_REASON_CODE_LENGTH} characters if provided`);
    }
  }

  return errors;
}

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

// Detour & Closure module - column-size ceilings from migration-017-detours.sql.
export const MAX_DETOUR_NUMBER_LENGTH = 50;
export const MAX_DETOUR_CLOSURE_LENGTH = 500;
export const MAX_DETOUR_RIDERS_DIRECTED_LENGTH = 500;
export const MAX_DETOUR_SEGMENT_ROUTES_LENGTH = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDetourSegments(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return ["segments must be an array if provided"];
  const errors: string[] = [];
  value.forEach((seg, i) => {
    if (typeof seg !== "object" || seg === null || Array.isArray(seg)) {
      errors.push(`segments[${i}] must be an object`);
      return;
    }
    const s = seg as Record<string, unknown>;
    if (typeof s.routes !== "string" || s.routes.trim() === "") {
      errors.push(`segments[${i}].routes is required and must be a non-empty string`);
    } else if (s.routes.length > MAX_DETOUR_SEGMENT_ROUTES_LENGTH) {
      errors.push(`segments[${i}].routes must be at most ${MAX_DETOUR_SEGMENT_ROUTES_LENGTH} characters`);
    }
    if (s.directions !== undefined && s.directions !== null && typeof s.directions !== "string") {
      errors.push(`segments[${i}].directions must be a string if provided`);
    }
  });
  return errors;
}

// POST /detours - create. `closure` is the only always-required field; a
// closure can be logged as monitor-only with no dates yet.
export function validateCreateDetour(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (typeof body.closure !== "string" || body.closure.trim() === "") {
    errors.push("closure is required and must be a non-empty string");
  } else if (body.closure.length > MAX_DETOUR_CLOSURE_LENGTH) {
    errors.push(`closure must be at most ${MAX_DETOUR_CLOSURE_LENGTH} characters`);
  }
  if (body.number !== undefined && body.number !== null) {
    if (typeof body.number !== "string") {
      errors.push("number must be a string if provided");
    } else if (body.number.length > MAX_DETOUR_NUMBER_LENGTH) {
      errors.push(`number must be at most ${MAX_DETOUR_NUMBER_LENGTH} characters`);
    }
  }
  for (const field of ["start_date", "end_date"]) {
    const v = body[field];
    if (v !== undefined && v !== null && (typeof v !== "string" || !DATE_RE.test(v))) {
      errors.push(`${field} must be a YYYY-MM-DD date string if provided`);
    }
  }
  if (body.is_monitor_only !== undefined && typeof body.is_monitor_only !== "boolean") {
    errors.push("is_monitor_only must be a boolean if provided");
  }
  if (body.riders_directed !== undefined && body.riders_directed !== null) {
    if (typeof body.riders_directed !== "string") {
      errors.push("riders_directed must be a string if provided");
    } else if (body.riders_directed.length > MAX_DETOUR_RIDERS_DIRECTED_LENGTH) {
      errors.push(`riders_directed must be at most ${MAX_DETOUR_RIDERS_DIRECTED_LENGTH} characters`);
    }
  }
  for (const field of ["email_sent", "expired_email_sent", "spare_emailed"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      errors.push(`${field} must be a boolean if provided`);
    }
  }
  errors.push(...isValidDetourSegments(body.segments));

  return errors;
}

// PATCH /detours/{id} - partial edit; every field optional, same shape checks
// as create for whatever is actually present.
export function validateUpdateDetour(body: UnknownBody): string[] {
  const errors: string[] = [];
  const editableFields = [
    "number", "closure", "start_date", "end_date", "is_monitor_only",
    "riders_directed", "email_sent", "expired_email_sent", "spare_emailed", "segments",
  ];
  if (!editableFields.some((f) => body[f] !== undefined)) {
    errors.push(`At least one of ${editableFields.join(", ")} must be provided`);
  }
  // Reuse validateCreateDetour's per-field checks, but only for fields that
  // are actually present - closure isn't required on a partial edit.
  if (body.closure !== undefined) {
    if (typeof body.closure !== "string" || body.closure.trim() === "") {
      errors.push("closure must be a non-empty string if provided");
    } else if (body.closure.length > MAX_DETOUR_CLOSURE_LENGTH) {
      errors.push(`closure must be at most ${MAX_DETOUR_CLOSURE_LENGTH} characters`);
    }
  }
  if (body.number !== undefined && body.number !== null) {
    if (typeof body.number !== "string") {
      errors.push("number must be a string if provided");
    } else if (body.number.length > MAX_DETOUR_NUMBER_LENGTH) {
      errors.push(`number must be at most ${MAX_DETOUR_NUMBER_LENGTH} characters`);
    }
  }
  for (const field of ["start_date", "end_date"]) {
    const v = body[field];
    if (v !== undefined && v !== null && (typeof v !== "string" || !DATE_RE.test(v))) {
      errors.push(`${field} must be a YYYY-MM-DD date string if provided`);
    }
  }
  if (body.is_monitor_only !== undefined && typeof body.is_monitor_only !== "boolean") {
    errors.push("is_monitor_only must be a boolean if provided");
  }
  if (body.riders_directed !== undefined && body.riders_directed !== null) {
    if (typeof body.riders_directed !== "string") {
      errors.push("riders_directed must be a string if provided");
    } else if (body.riders_directed.length > MAX_DETOUR_RIDERS_DIRECTED_LENGTH) {
      errors.push(`riders_directed must be at most ${MAX_DETOUR_RIDERS_DIRECTED_LENGTH} characters`);
    }
  }
  for (const field of ["email_sent", "expired_email_sent", "spare_emailed"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      errors.push(`${field} must be a boolean if provided`);
    }
  }
  if (body.segments !== undefined) {
    errors.push(...isValidDetourSegments(body.segments));
  }

  return errors;
}

// PUT /route-classification/{routeId}
export const VALID_ROUTE_CATEGORIES = ["FixedRoute", "SpecialEvent", "OnDemand"] as const;
export const MAX_ROUTE_LABEL_LENGTH = 100;

export function validateRouteClassification(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (!includes(VALID_ROUTE_CATEGORIES, body.route_category)) {
    errors.push(`route_category must be one of: ${VALID_ROUTE_CATEGORIES.join(", ")}`);
  }
  if (body.route_label !== undefined && body.route_label !== null) {
    if (typeof body.route_label !== "string") {
      errors.push("route_label must be a string if provided");
    } else if (body.route_label.length > MAX_ROUTE_LABEL_LENGTH) {
      errors.push(`route_label must be at most ${MAX_ROUTE_LABEL_LENGTH} characters`);
    }
  }
  for (const field of ["effective_start_date", "effective_end_date"]) {
    const v = body[field];
    if (v !== undefined && v !== null && (typeof v !== "string" || !DATE_RE.test(v))) {
      errors.push(`${field} must be a YYYY-MM-DD date string if provided`);
    }
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    errors.push("is_active must be a boolean if provided");
  }

  return errors;
}

// OTP Compliance completion - persisted exclusions, reason codes, threshold
// setting. See migration-018-otp-exclusions-and-settings.sql.
const SERVICE_MONTH_RE = /^\d{6}$/;
const SERVICE_DATE_RE = /^\d{8}$/;
export const VALID_STOP_EXCLUSION_STATUSES = ["approved", "rejected"] as const;
export const VALID_DATE_EXCLUSION_SCOPES = ["Agency", "Route"] as const;
export const MAX_REASON_CODE_LENGTH = 30;
export const MAX_REASON_LABEL_LENGTH = 100;
export const MAX_DATE_EXCLUSION_NOTES_LENGTH = 500;

// PUT /otp-stop-exclusions
export function validateStopExclusion(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (typeof body.service_month !== "string" || !SERVICE_MONTH_RE.test(body.service_month)) {
    errors.push("service_month is required and must be a YYYYMM string");
  }
  if (typeof body.route_id !== "number" || !Number.isInteger(body.route_id)) {
    errors.push("route_id is required and must be an integer");
  }
  if (typeof body.stop_id !== "number" || !Number.isInteger(body.stop_id)) {
    errors.push("stop_id is required and must be an integer");
  }
  if (typeof body.day_of_week !== "string" || body.day_of_week.trim() === "") {
    errors.push("day_of_week is required and must be a non-empty string");
  }
  if (!includes(VALID_STOP_EXCLUSION_STATUSES, body.status)) {
    errors.push(`status must be one of: ${VALID_STOP_EXCLUSION_STATUSES.join(", ")}`);
  }
  if (body.reason_code !== undefined && body.reason_code !== null) {
    if (typeof body.reason_code !== "string" || body.reason_code.length > MAX_REASON_CODE_LENGTH) {
      errors.push(`reason_code must be a string of at most ${MAX_REASON_CODE_LENGTH} characters if provided`);
    }
  }

  return errors;
}

// POST /otp-date-exclusions
export function validateDateExclusion(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (!includes(VALID_DATE_EXCLUSION_SCOPES, body.scope)) {
    errors.push(`scope must be one of: ${VALID_DATE_EXCLUSION_SCOPES.join(", ")}`);
  }
  if (body.scope === "Route" && (typeof body.route_id !== "number" || !Number.isInteger(body.route_id))) {
    errors.push("route_id is required and must be an integer when scope is Route");
  }
  if (typeof body.service_date !== "string" || !SERVICE_DATE_RE.test(body.service_date)) {
    errors.push("service_date is required and must be a YYYYMMDD string");
  }
  if (typeof body.reason_code !== "string" || body.reason_code.trim() === "") {
    errors.push("reason_code is required and must be a non-empty string");
  } else if (body.reason_code.length > MAX_REASON_CODE_LENGTH) {
    errors.push(`reason_code must be at most ${MAX_REASON_CODE_LENGTH} characters`);
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string" || body.notes.length > MAX_DATE_EXCLUSION_NOTES_LENGTH) {
      errors.push(`notes must be a string of at most ${MAX_DATE_EXCLUSION_NOTES_LENGTH} characters if provided`);
    }
  }

  return errors;
}

// migration-023 added 'missed_trip' as a third applies_to value, reusing
// this table for Missed Trips' investigation-outcome dropdown instead of
// standing up a separate reason-code table for one more use case.
const VALID_REASON_CODE_APPLIES_TO = ["stop", "date", "missed_trip"] as const;

// POST /otp-reason-codes
export function validateCreateReasonCode(body: UnknownBody): string[] {
  const errors: string[] = [];

  if (typeof body.code !== "string" || body.code.trim() === "") {
    errors.push("code is required and must be a non-empty string");
  } else if (body.code.length > MAX_REASON_CODE_LENGTH) {
    errors.push(`code must be at most ${MAX_REASON_CODE_LENGTH} characters`);
  }
  if (typeof body.label !== "string" || body.label.trim() === "") {
    errors.push("label is required and must be a non-empty string");
  } else if (body.label.length > MAX_REASON_LABEL_LENGTH) {
    errors.push(`label must be at most ${MAX_REASON_LABEL_LENGTH} characters`);
  }
  if (!includes(VALID_REASON_CODE_APPLIES_TO, body.applies_to)) {
    errors.push(`applies_to must be one of: ${VALID_REASON_CODE_APPLIES_TO.join(", ")}`);
  }

  return errors;
}

// PATCH /otp-reason-codes/{id} - code/applies_to are immutable after
// creation; only presentation/lifecycle fields are editable.
export function validateUpdateReasonCode(body: UnknownBody): string[] {
  const errors: string[] = [];
  const editableFields = ["label", "is_active", "sort_order"];
  if (!editableFields.some((f) => body[f] !== undefined)) {
    errors.push(`At least one of ${editableFields.join(", ")} must be provided`);
  }
  if (body.label !== undefined) {
    if (typeof body.label !== "string" || body.label.trim() === "") {
      errors.push("label must be a non-empty string if provided");
    } else if (body.label.length > MAX_REASON_LABEL_LENGTH) {
      errors.push(`label must be at most ${MAX_REASON_LABEL_LENGTH} characters`);
    }
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    errors.push("is_active must be a boolean if provided");
  }
  if (body.sort_order !== undefined && (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order))) {
    errors.push("sort_order must be an integer if provided");
  }
  return errors;
}

// PATCH /otp-settings
export function validateOtpSettings(body: UnknownBody): string[] {
  const errors: string[] = [];
  const threshold = body.early_late_bias_threshold;
  if (typeof threshold !== "number" || threshold <= 0 || threshold >= 1) {
    errors.push("early_late_bias_threshold is required and must be a number between 0 and 1 (exclusive)");
  }
  return errors;
}

// POST /otp-historical-backfill - one-time admin-triggered fetch of OTP
// Monthly + Missed Trips for months outside the daily poller's trailing
// window (see otpHistoricalBackfill.ts). MAX_BACKFILL_MONTHS caps a
// typo'd range (e.g. wrong year) from spinning through years of empty
// Avail requests.
export const MAX_BACKFILL_MONTHS = 24;

export function validateOtpHistoricalBackfill(body: UnknownBody): string[] {
  const errors: string[] = [];
  const from = body.from;
  const to = body.to;
  if (typeof from !== "string" || !SERVICE_MONTH_RE.test(from)) {
    errors.push("from is required and must be a YYYYMM string");
  }
  if (typeof to !== "string" || !SERVICE_MONTH_RE.test(to)) {
    errors.push("to is required and must be a YYYYMM string");
  }
  if (typeof from === "string" && typeof to === "string" && SERVICE_MONTH_RE.test(from) && SERVICE_MONTH_RE.test(to)) {
    if (to < from) {
      errors.push("to must not be earlier than from");
    }
  }
  return errors;
}

// Detour image attachments - Part B3 of detour-and-event-module-
// implementation-plan.md. Column-size ceilings from migration-017-detours.sql.
export const MAX_IMAGE_FILE_NAME_LENGTH = 255;
export const MAX_IMAGE_CAPTION_LENGTH = 500;

// POST /detours/{id}/images/upload-url
export function validateUploadUrlRequest(body: UnknownBody): string[] {
  const errors: string[] = [];
  if (typeof body.file_name !== "string" || body.file_name.trim() === "") {
    errors.push("file_name is required and must be a non-empty string");
  } else if (body.file_name.length > MAX_IMAGE_FILE_NAME_LENGTH) {
    errors.push(`file_name must be at most ${MAX_IMAGE_FILE_NAME_LENGTH} characters`);
  }
  if (body.content_type !== undefined && body.content_type !== null && typeof body.content_type !== "string") {
    errors.push("content_type must be a string if provided");
  }
  return errors;
}

// POST /detours/{id}/images
export function validateCreateDetourImage(body: UnknownBody): string[] {
  const errors: string[] = [];
  if (typeof body.blob_path !== "string" || body.blob_path.trim() === "") {
    errors.push("blob_path is required and must be a non-empty string");
  }
  if (typeof body.file_name !== "string" || body.file_name.trim() === "") {
    errors.push("file_name is required and must be a non-empty string");
  } else if (body.file_name.length > MAX_IMAGE_FILE_NAME_LENGTH) {
    errors.push(`file_name must be at most ${MAX_IMAGE_FILE_NAME_LENGTH} characters`);
  }
  if (body.content_type !== undefined && body.content_type !== null && typeof body.content_type !== "string") {
    errors.push("content_type must be a string if provided");
  }
  if (body.size_bytes !== undefined && body.size_bytes !== null) {
    if (typeof body.size_bytes !== "number" || !Number.isInteger(body.size_bytes) || body.size_bytes < 0) {
      errors.push("size_bytes must be a non-negative integer if provided");
    }
  }
  if (body.caption !== undefined && body.caption !== null) {
    if (typeof body.caption !== "string") {
      errors.push("caption must be a string if provided");
    } else if (body.caption.length > MAX_IMAGE_CAPTION_LENGTH) {
      errors.push(`caption must be at most ${MAX_IMAGE_CAPTION_LENGTH} characters`);
    }
  }
  return errors;
}

export { VALID_CATEGORIES, VALID_SEVERITIES, VALID_EXPIRATION_SOURCES, VALID_CONSENT_SOURCES };
