import crypto from "node:crypto";

// The credential a rider uses to manage their own subscription.
//
// It travels in the footer of every alert email and has to work indefinitely,
// which is what separates it from a confirmation token: those expire in 24
// hours and are spent on use. It is a bearer credential - the same thing every
// unsubscribe link in every mailing list is - so what keeps it safe is not
// secrecy in transit but how little it authorizes. Increment B holds that part:
// one subscriber, a masked contact, preferences only, and never a contact
// change.
//
// 32 bytes. Hex rather than base64url so the shape matches what migration 119's
// backfill can produce in T-SQL, where CONVERT(..., 2) is hex and base64url is
// a hand-rolled translation. 64 characters in a URL, and URL-safe either way.
const MANAGE_KEY_BYTES = 32;

export function makeManageKey(): string {
  return crypto.randomBytes(MANAGE_KEY_BYTES).toString("hex");
}

/** The shape migration 119 stores and increment B looks up. */
export function isManageKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
