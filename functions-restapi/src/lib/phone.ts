// E.164 normalization, server side.
//
// `Subscribers.phone_number` is stored in E.164 and `validateSubscribe`
// refuses anything else, so every lookup by number has to be made against the
// same shape. A number that arrives as "612-555-0123" does not match the row
// that holds "+16125550123"; it reads as a number that never subscribed, which
// is the one answer the rider cannot act on.
//
// The rider app normalizes at the form (`normalizeUsPhone` in
// @mvta/shared, 1.5.188) so the rider can see and correct the result before
// submitting. This is the same function again rather than an import: the
// Function App is a separate package that does not build the frontend
// workspace. Duplication is the cost of that boundary, and the rules are
// pinned by phone.test.ts here and phone.test.ts there so the two cannot drift
// silently.
//
// Normalizing at the form is a convenience. Normalizing here is correctness:
// `confirm-sms` accepts a number from whatever is posting to it, and a caller
// that never loaded the form has done nothing wrong by sending the number the
// way a person writes it.

/** True if the value is already in the E.164 form the API stores. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * Best-effort E.164 for a North American number as a rider would type it.
 * Returns null when the digits cannot be read as one, so the caller answers
 * "that did not work" rather than querying for a number that cannot exist.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // An explicit country code is the caller's own claim about the number; keep
  // it and only strip the punctuation typed around it.
  if (trimmed.startsWith("+")) {
    const candidate = "+" + trimmed.slice(1).replace(/\D/g, "");
    return isE164(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
