// Recording a Dispatch Log verification (plans/dispatch-log-spec.md §4.2,
// §7.1 decided 2026-09-05: SST OCS staff record them). A verification is an
// observation, not a measurement - it records what a person saw - so it is
// stored apart from the poller's actuals and never overwritten by them, and
// every write is also appended to TripStartVerificationEvents as the audit
// trail. The workbook's three cell states map to three observations; "clear"
// returns a cell to blank and is recorded as such.
export const TRIP_START_OBSERVATIONS = ["observed_on_time", "observed_left_late", "not_observed"] as const;
export type TripStartObservation = (typeof TRIP_START_OBSERVATIONS)[number];
export type TripStartVerificationAction = TripStartObservation | "clear";

export const MAX_NOTE_LENGTH = 500;      // TripStartVerifications.note NVARCHAR(500)
export const MAX_INITIALS_LENGTH = 10;   // TripStartVerifications.verified_initials NVARCHAR(10)

export interface VerificationInput {
  service_date: string;
  trip_id: string;
  action: TripStartVerificationAction;
  note: string | null;
  initials: string | null;
}

export type VerificationValidation = { ok: true; value: VerificationInput } | { ok: false; errors: string[] };

export function validateVerificationInput(body: unknown): VerificationValidation {
  const errors: string[] = [];
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const serviceDate = typeof b.service_date === "string" ? b.service_date.trim() : "";
  if (!/^\d{8}$/.test(serviceDate)) errors.push("service_date must be YYYYMMDD");
  const tripId = typeof b.trip_id === "string" ? b.trip_id.trim() : "";
  if (!tripId || tripId.length > 100) errors.push("trip_id is required");
  const action = b.action;
  if (typeof action !== "string" || !([...TRIP_START_OBSERVATIONS, "clear"] as string[]).includes(action)) {
    errors.push(`action must be one of ${[...TRIP_START_OBSERVATIONS, "clear"].join(", ")}`);
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") errors.push("note must be text");
    else if (b.note.length > MAX_NOTE_LENGTH) errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters`);
    else note = b.note.trim() || null;
  }
  let initials: string | null = null;
  if (b.initials !== undefined && b.initials !== null) {
    if (typeof b.initials !== "string") errors.push("initials must be text");
    else {
      const cleaned = b.initials.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
      if (cleaned.length === 0 || cleaned.length > MAX_INITIALS_LENGTH) errors.push(`initials must be 1-${MAX_INITIALS_LENGTH} letters`);
      else initials = cleaned;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { service_date: serviceDate, trip_id: tripId, action: action as TripStartVerificationAction, note, initials } };
}

/**
 * The initials the workbook cell shows. The caller's own choice wins; else
 * the display name's word initials ("Jane Doe" -> JD); else the sign-in
 * name's local part split on dots and hyphens ("jane.doe@x" -> JD).
 */
export function initialsFor(displayName: string | undefined, userDetails: string | undefined, requested: string | null): string {
  if (requested) return requested.slice(0, MAX_INITIALS_LENGTH);
  const fromName = wordInitials(displayName ?? "");
  if (fromName) return fromName;
  const local = (userDetails ?? "").split("@")[0] ?? "";
  const fromLogin = wordInitials(local.replace(/[._\-]+/g, " "));
  return fromLogin || "?";
}

function wordInitials(text: string): string {
  const words = text.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return "";
  // "Doe, Jane" style names put the surname first; keep reading order otherwise.
  const ordered = text.includes(",") ? [...words.slice(1), words[0]!] : words;
  return ordered.map((w) => w.replace(/[^\p{L}]/gu, "").charAt(0).toUpperCase()).join("").slice(0, MAX_INITIALS_LENGTH);
}
