// The API stores and dials phone numbers in E.164 (functions-restapi
// validation.ts: /^\+[1-9]\d{7,14}$/), but riders type what is on their phone:
// "612-555-0123", "(612) 555-0123", "1 612 555 0123". Left as typed, every one
// of those is a 400 from the opt-in endpoint, which the form could only report
// as "check your contact information" — so normalize here, at the form, where
// the rider can still see and correct the result.

/** True if the value is already in the E.164 form the API accepts. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * Best-effort E.164 for a North American number as a rider would type it.
 * Returns null when the digits cannot be read as one, so the caller can ask
 * for a correction instead of sending something the API will reject.
 */
export function normalizeUsPhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // An explicit country code is the rider's own claim about the number; keep
  // it and only strip the punctuation they typed around it.
  if (trimmed.startsWith("+")) {
    const candidate = "+" + trimmed.slice(1).replace(/\D/g, "");
    return isE164(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+16125550123" -> "+1 (612) 555-0123", so the rider can check it. */
export function formatE164ForDisplay(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
