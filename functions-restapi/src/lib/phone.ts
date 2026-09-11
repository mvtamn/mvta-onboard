// E.164 normalization, server side.
//
// DELIBERATELY A SECOND COPY of frontend/packages/shared/src/phone.ts. The
// opt-in form normalizes before it posts (1.5.188), but the form is not the
// only caller and a browser is not a place to enforce anything: the SMS
// confirmation endpoint takes a number a rider re-types, and it has to match
// what was stored or the confirmation silently finds nothing.
//
// The two copies cannot be one module - @mvta/shared is a frontend workspace
// package built by vite, and functions-restapi is a separate Node app that
// does not depend on it. phone.test.ts runs the same table of inputs as the
// frontend's, so the pair drifting apart is a failing test rather than a
// confirmation that never matches.

/** True if the value is already in the E.164 form the API stores and ACS dials. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * Best-effort E.164 for a North American number as a rider would type it.
 * Returns null when the digits cannot be read as one.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // An explicit country code is the caller's own claim about the number; keep
  // it and only strip the punctuation around it.
  if (trimmed.startsWith("+")) {
    const candidate = "+" + trimmed.slice(1).replace(/\D/g, "");
    return isE164(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
