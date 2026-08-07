import { test } from "node:test";
import assert from "node:assert";
import {
  validateCreateMessage,
  validatePrepareSuggestedAlert,
  validateMissedTripValidation,
  validateDraftSummary,
  validateCreateDetour,
  validateUpdateDetour,
  validateStopExclusion,
  validateDateExclusion,
  validateCreateReasonCode,
  validateUpdateReasonCode,
  validateOtpSettings,
  validateOtpHistoricalBackfill,
  validateUploadUrlRequest,
  validateCreateDetourImage,
  validateDetourReport,
  validateCreateDetourReasonCode,
  validateUpdateDetourReasonCode,
  MAX_DETOUR_RESOLUTION_NOTES_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_CREATED_BY_LENGTH,
  MAX_MISSED_TRIP_NOTES_LENGTH,
  MAX_DRAFT_RAW_TEXT_LENGTH,
  MAX_DETOUR_CLOSURE_LENGTH,
} from "./validation";

test("valid message passes with no errors", () => {
  const errors = validateCreateMessage({
    raw_text: "Elevator out of service",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.deepStrictEqual(errors, []);
});

test("rejects missing raw_text", () => {
  const errors = validateCreateMessage({
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("raw_text")));
});

test("rejects invalid category", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "not_a_real_category",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("category")));
});

test("rejects invalid severity", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "super-duper-bad",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("severity")));
});

test("rejects unparseable expires_at", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "not-a-date",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
  });
  assert.ok(errors.some((e) => e.includes("expires_at")));
});

test("rejects non-array routes_affected", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    routes_affected: "Route 5",
  });
  assert.ok(errors.some((e) => e.includes("routes_affected")));
});

test("rejects summary longer than the column allows", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    summary: "x".repeat(MAX_SUMMARY_LENGTH + 1),
  });
  assert.ok(errors.some((e) => e.includes("summary")));
});

test("accepts summary exactly at the column limit", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "j.alvarez",
    summary: "x".repeat(MAX_SUMMARY_LENGTH),
  });
  assert.deepStrictEqual(errors, []);
});

test("rejects created_by longer than the column allows", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
    created_by: "x".repeat(MAX_CREATED_BY_LENGTH + 1),
  });
  assert.ok(errors.some((e) => e.includes("created_by")));
});

test("created_by is optional - omitting it entirely still validates", () => {
  // The server always derives created_by from the verified auth principal
  // (see messagesCreate.ts), never from the client body, so the frontend
  // legitimately never sends this field for a human caller.
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "outage",
    severity: "minor",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "inferred_text",
  });
  assert.deepStrictEqual(errors, []);
});

test("accepts null optional array fields", () => {
  const errors = validateCreateMessage({
    raw_text: "test",
    category: "general",
    severity: "informational",
    expires_at: "2026-07-06T23:59:00Z",
    expiration_source: "category_default",
    created_by: "delay_detection",
    routes_affected: null,
    tags: null,
  });
  assert.deepStrictEqual(errors, []);
});

test("valid suggested alert preparation passes", () => {
  const errors = validatePrepareSuggestedAlert({
    source: "gtfs_rt",
    external_id: "delay:2026-07-26:trip-42",
    draft_text: "Route 442 is predicted to depart 18 minutes late.",
    category: "delay",
    severity: "minor",
    routes_affected: ["442"],
    detail: { trip_id: "trip-42" },
  });
  assert.deepStrictEqual(errors, []);
});

test("suggested alert preparation rejects invalid dedup and detail fields", () => {
  const errors = validatePrepareSuggestedAlert({
    source: "manual",
    external_id: "",
    draft_text: "",
    category: "delay",
    severity: "minor",
    routes_affected: "442",
    detail: null,
  });
  assert.ok(errors.some((e) => e.includes("source")));
  assert.ok(errors.some((e) => e.includes("external_id")));
  assert.ok(errors.some((e) => e.includes("draft_text")));
  assert.ok(errors.some((e) => e.includes("routes_affected")));
  assert.ok(errors.some((e) => e.includes("detail")));
});

test("valid missed-trip validation passes", () => {
  const errors = validateMissedTripValidation({
    trip_id: "t65A-b13B-sl2B-v62",
    service_date: "20260727",
    validation_status: "confirmed",
    notes: "Confirmed via dispatch log - vehicle never left the garage.",
  });
  assert.deepStrictEqual(errors, []);
});

test("missed-trip validation rejects missing keys and an invalid status", () => {
  const errors = validateMissedTripValidation({
    trip_id: "",
    service_date: "",
    validation_status: "unreviewed",
  });
  assert.ok(errors.some((e) => e.includes("trip_id")));
  assert.ok(errors.some((e) => e.includes("service_date")));
  assert.ok(errors.some((e) => e.includes("validation_status")));
});

test("missed-trip validation notes is optional but bounded when provided", () => {
  const withoutNotes = validateMissedTripValidation({
    trip_id: "t1",
    service_date: "20260727",
    validation_status: "false_positive",
  });
  assert.deepStrictEqual(withoutNotes, []);

  const withOversizedNotes = validateMissedTripValidation({
    trip_id: "t1",
    service_date: "20260727",
    validation_status: "false_positive",
    notes: "x".repeat(MAX_MISSED_TRIP_NOTES_LENGTH + 1),
  });
  assert.ok(withOversizedNotes.some((e) => e.includes("notes")));
});

test("missed-trip validation accepts an optional reason_code", () => {
  const withReason = validateMissedTripValidation({
    trip_id: "t1",
    service_date: "20260727",
    validation_status: "confirmed",
    reason_code: "VEHICLE_BREAKDOWN",
  });
  assert.deepStrictEqual(withReason, []);

  const withOversizedReason = validateMissedTripValidation({
    trip_id: "t1",
    service_date: "20260727",
    validation_status: "confirmed",
    reason_code: "x".repeat(31),
  });
  assert.ok(withOversizedReason.some((e) => e.includes("reason_code")));
});

test("valid draft-summary request passes", () => {
  const errors = validateDraftSummary({
    raw_text: "440SB @ 4:35PM running 26 minutes down due to traffic",
    category: "delay",
    severity: "minor",
  });
  assert.deepStrictEqual(errors, []);
});

test("draft-summary rejects missing raw_text and invalid category/severity", () => {
  const errors = validateDraftSummary({
    raw_text: "",
    category: "not-a-category",
    severity: "not-a-severity",
  });
  assert.ok(errors.some((e) => e.includes("raw_text")));
  assert.ok(errors.some((e) => e.includes("category")));
  assert.ok(errors.some((e) => e.includes("severity")));
});

test("draft-summary rejects raw_text longer than the ceiling", () => {
  const errors = validateDraftSummary({
    raw_text: "x".repeat(MAX_DRAFT_RAW_TEXT_LENGTH + 1),
    category: "delay",
    severity: "minor",
  });
  assert.ok(errors.some((e) => e.includes("raw_text")));
});

test("valid detour creation passes with no errors", () => {
  const errors = validateCreateDetour({
    number: "951",
    closure: "5th St closed between Main and 3rd",
    start_date: "2026-08-01",
    end_date: "2026-08-15",
    segments: [{ routes: "460 SB, 465 SB", directions: "Turn right onto Main St" }],
  });
  assert.deepStrictEqual(errors, []);
});

test("detour creation requires closure but not dates (monitor-only case)", () => {
  const errors = validateCreateDetour({ is_monitor_only: true });
  assert.ok(errors.some((e) => e.includes("closure")));
});

test("detour creation rejects a closure longer than the column allows", () => {
  const errors = validateCreateDetour({ closure: "x".repeat(MAX_DETOUR_CLOSURE_LENGTH + 1) });
  assert.ok(errors.some((e) => e.includes("closure")));
});

test("detour creation rejects malformed dates and segments", () => {
  const errors = validateCreateDetour({
    closure: "Test closure",
    start_date: "not-a-date",
    segments: [{ routes: "" }],
  });
  assert.ok(errors.some((e) => e.includes("start_date")));
  assert.ok(errors.some((e) => e.includes("segments[0].routes")));
});

test("detour update requires at least one editable field", () => {
  const errors = validateUpdateDetour({});
  assert.ok(errors.some((e) => e.includes("At least one of")));
});

test("detour update accepts a single field with no other errors", () => {
  const errors = validateUpdateDetour({ email_sent: true });
  assert.deepStrictEqual(errors, []);
});

// Reporting fields - Part B6.

test("detour report fields are all optional", () => {
  assert.deepStrictEqual(validateDetourReport({}), []);
});

test("valid detour report fields pass with no errors", () => {
  const errors = validateDetourReport({
    reason_code: "special_event",
    severity: "major",
    reported_by: "Barbara Derrick",
    reported_at: "2026-08-07T14:30",
    approved_by: "Jason Francis",
    approved_at: "2026-08-07T15:00:00Z",
    radio_notified: true,
    dispatch_board_notified: false,
    social_media_notified: true,
    resolution_notes: "Corridor reopened ahead of schedule.",
  });
  assert.deepStrictEqual(errors, []);
});

test("detour report rejects a severity outside the three-tier scale", () => {
  const errors = validateDetourReport({ severity: "catastrophic" });
  assert.ok(errors.some((e) => e.includes("severity")));
});

test("detour report accepts an explicitly null severity (not yet assessed)", () => {
  assert.deepStrictEqual(validateDetourReport({ severity: null }), []);
});

test("detour report rejects an unparseable reported_at", () => {
  const errors = validateDetourReport({ reported_at: "last Tuesday" });
  assert.ok(errors.some((e) => e.includes("reported_at")));
});

test("detour report rejects resolution notes longer than the column allows", () => {
  const errors = validateDetourReport({
    resolution_notes: "x".repeat(MAX_DETOUR_RESOLUTION_NOTES_LENGTH + 1),
  });
  assert.ok(errors.some((e) => e.includes("resolution_notes")));
});

test("detour report rejects a non-boolean channel flag", () => {
  const errors = validateDetourReport({ radio_notified: "yes" });
  assert.ok(errors.some((e) => e.includes("radio_notified")));
});

test("detour create surfaces reporting-field errors alongside its own", () => {
  const errors = validateCreateDetour({ closure: "", severity: "huge" });
  assert.ok(errors.some((e) => e.includes("closure")));
  assert.ok(errors.some((e) => e.includes("severity")));
});

test("detour update accepts a reporting field as the only change", () => {
  assert.deepStrictEqual(validateUpdateDetour({ severity: "minor" }), []);
});

test("detour reason code create requires both code and label", () => {
  const errors = validateCreateDetourReasonCode({ code: "bridge_lift" });
  assert.ok(errors.some((e) => e.includes("label")));
});

test("detour reason code update rejects an empty body and ignores code", () => {
  assert.ok(validateUpdateDetourReasonCode({}).some((e) => e.includes("At least one of")));
  // `code` is not editable - passing only it counts as passing nothing.
  assert.ok(validateUpdateDetourReasonCode({ code: "renamed" }).some((e) => e.includes("At least one of")));
});

test("valid stop exclusion passes with no errors", () => {
  const errors = validateStopExclusion({
    service_month: "202608",
    route_id: 90,
    stop_id: 3242,
    day_of_week: "Wed",
    status: "approved",
    reason_code: "SCHED_RECOVERY",
  });
  assert.deepStrictEqual(errors, []);
});

test("stop exclusion rejects a bad service_month and invalid status", () => {
  const errors = validateStopExclusion({
    service_month: "2026-08",
    route_id: 90,
    stop_id: 3242,
    day_of_week: "Wed",
    status: "maybe",
  });
  assert.ok(errors.some((e) => e.includes("service_month")));
  assert.ok(errors.some((e) => e.includes("status")));
});

test("valid Agency-scope date exclusion passes with no errors", () => {
  const errors = validateDateExclusion({
    scope: "Agency",
    service_date: "20260112",
    reason_code: "WEATHER_SNOW",
  });
  assert.deepStrictEqual(errors, []);
});

test("Route-scope date exclusion requires route_id", () => {
  const errors = validateDateExclusion({
    scope: "Route",
    service_date: "20260203",
    reason_code: "EMERGENCY_ROAD",
  });
  assert.ok(errors.some((e) => e.includes("route_id")));
});

test("date exclusion rejects missing reason_code and malformed service_date", () => {
  const errors = validateDateExclusion({ scope: "Agency", service_date: "2026-01-12" });
  assert.ok(errors.some((e) => e.includes("service_date")));
  assert.ok(errors.some((e) => e.includes("reason_code")));
});

test("valid reason code creation passes with no errors", () => {
  const errors = validateCreateReasonCode({ code: "OTHER", label: "Other", applies_to: "stop" });
  assert.deepStrictEqual(errors, []);
});

test("reason code creation accepts missed_trip as applies_to", () => {
  const errors = validateCreateReasonCode({ code: "WEATHER", label: "Weather", applies_to: "missed_trip" });
  assert.deepStrictEqual(errors, []);
});

test("reason code creation rejects invalid applies_to", () => {
  const errors = validateCreateReasonCode({ code: "X", label: "X", applies_to: "route" });
  assert.ok(errors.some((e) => e.includes("applies_to")));
});

test("reason code update requires at least one field", () => {
  const errors = validateUpdateReasonCode({});
  assert.ok(errors.some((e) => e.includes("At least one of")));
});

test("reason code update accepts is_active alone", () => {
  const errors = validateUpdateReasonCode({ is_active: false });
  assert.deepStrictEqual(errors, []);
});

test("valid OTP settings update passes with no errors", () => {
  const errors = validateOtpSettings({ early_late_bias_threshold: 0.2 });
  assert.deepStrictEqual(errors, []);
});

test("OTP settings update rejects out-of-range thresholds", () => {
  assert.ok(validateOtpSettings({ early_late_bias_threshold: 0 }).length > 0);
  assert.ok(validateOtpSettings({ early_late_bias_threshold: 1 }).length > 0);
  assert.ok(validateOtpSettings({ early_late_bias_threshold: "0.2" }).length > 0);
});

test("valid historical backfill request passes with no errors", () => {
  const errors = validateOtpHistoricalBackfill({ month: "202601" });
  assert.deepStrictEqual(errors, []);
});

test("historical backfill rejects a malformed or missing month", () => {
  assert.ok(validateOtpHistoricalBackfill({ month: "2026-01" }).length > 0);
  assert.ok(validateOtpHistoricalBackfill({}).length > 0);
});

test("valid upload-url request passes with no errors", () => {
  const errors = validateUploadUrlRequest({ file_name: "sign.jpg", content_type: "image/jpeg" });
  assert.deepStrictEqual(errors, []);
});

test("upload-url request rejects a missing file_name", () => {
  const errors = validateUploadUrlRequest({});
  assert.ok(errors.some((e) => e.includes("file_name")));
});

test("valid detour image creation passes with no errors", () => {
  const errors = validateCreateDetourImage({
    blob_path: "detours/1/abc-sign.jpg",
    file_name: "sign.jpg",
    content_type: "image/jpeg",
    size_bytes: 12345,
    caption: "Detour sign",
  });
  assert.deepStrictEqual(errors, []);
});

test("detour image creation rejects missing blob_path/file_name and a negative size", () => {
  const errors = validateCreateDetourImage({ size_bytes: -1 });
  assert.ok(errors.some((e) => e.includes("blob_path")));
  assert.ok(errors.some((e) => e.includes("file_name")));
  assert.ok(errors.some((e) => e.includes("size_bytes")));
});
