// The rider-facing half of double opt-in: the three ways a subscription gets
// finished. Until these existed nothing could move a subscriber out of
// 'pending_confirmation' (CURRENT_STATE section 7.2), so the audience for
// every alert was empty.
//
//   GET  /api/subscribers/confirm-email?token=  the link in the email
//   POST /api/subscribers/confirm-sms           the code typed into the page
//   POST /api/subscribers/resend                "I didn't get it"
//
// All three are anonymous, because the token IS the credential and the people
// using them have no account. The inbound-SMS path - a rider replying to the
// text rather than typing the code - is increment 5.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { normalizeUsPhone } from "../lib/phone";
import { publishConfirmationRequested } from "../lib/events";
import {
  confirmEmail,
  confirmSms,
  requestResend,
  type ConfirmOutcome,
  type Channel,
} from "../lib/subscriberConfirmation";

/** Run one operation in its own transaction. Confirming is all-or-nothing. */
async function inTransaction<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back / not begun */
    }
    throw err;
  }
}

// Where the email link sends the rider afterwards. RIDER_APP_BASE_URL is
// declared in functionapp.bicep; unset, a relative path still works when the
// API and the app are behind the same Front Door, which they are.
function landingUrl(status: string): string {
  const base = (process.env.RIDER_APP_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/subscribe/confirmed?status=${encodeURIComponent(status)}`;
}

app.http("subscribersConfirmEmail", {
  route: "subscribers/confirm-email",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const token = request.query.get("token") ?? "";

    // A GET that changes state, which is right in exactly this one place: the
    // rider's click IS the request and there is no opportunity to POST. What
    // makes it acceptable is that the token is single-use and expiring. The
    // cost is real and worth naming - a mail scanner that prefetches links
    // will confirm the subscription on the rider's behalf, which is why the
    // SMS channel uses a code the rider has to type rather than a link.
    let outcome: ConfirmOutcome = "not_found";
    if (token) {
      try {
        outcome = (await inTransaction((tx) => confirmEmail(tx, token))).outcome;
      } catch (err) {
        context.error("GET /subscribers/confirm-email failed:", err);
        // The rider gets a page rather than a JSON 500. They cannot act on the
        // difference between "your link is bad" and "our database is down",
        // but they can act on "try again", which is what the page says.
        return { status: 302, headers: { Location: landingUrl("error") } };
      }
    }

    // The token is never reflected back, in the body or the redirect: it would
    // land in the rider app's browser history and in any referrer.
    return { status: 302, headers: { Location: landingUrl(outcome) } };
  },
});

/**
 * Answers that do not distinguish a wrong code from a number that has no
 * pending confirmation.
 *
 * This endpoint takes a phone number from anyone. Telling a caller which of
 * those two happened would let them ask whether any given number is partway
 * through signing up for MVTA alerts. The inbound-SMS path (increment 5) is
 * free to be specific, because there the sender demonstrably owns the number.
 *
 * The other outcomes ARE reported, and that is a deliberate trade rather than
 * an oversight: reaching "expired" or "too_many_attempts" does reveal that the
 * number has an unconfirmed confirmation, but a rider whose code has expired
 * can do nothing with "that didn't work" and everything with "that expired,
 * here is a new one". The narrower leak buys the only useful thing the page
 * can say.
 */
export function smsAnswer(outcome: ConfirmOutcome): { status: number; body: { status: string } } {
  switch (outcome) {
    case "confirmed":
    case "already_confirmed":
      return { status: 200, body: { status: "confirmed" } };
    case "incorrect_code":
    case "not_found":
      return { status: 400, body: { status: "incorrect_code" } };
    default:
      return { status: 400, body: { status: outcome } };
  }
}

app.http("subscribersConfirmSms", {
  route: "subscribers/confirm-sms",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const body = (raw ?? {}) as { phone_number?: unknown; code?: unknown };

    // Normalized server-side rather than trusted from the form: the number has
    // to match what opt-in stored, and a browser is not where that is enforced.
    const phone = typeof body.phone_number === "string" ? normalizeUsPhone(body.phone_number) : null;
    const code = typeof body.code === "string" ? body.code.trim() : "";

    // An unreadable number and a malformed code are the same answer as a wrong
    // code, for the same reason: none of them may become a way to probe.
    if (!phone || !/^\d{6}$/.test(code)) {
      return { status: 400, jsonBody: smsAnswer("incorrect_code").body };
    }

    try {
      const result = await inTransaction((tx) => confirmSms(tx, phone, code));
      const answer = smsAnswer(result.outcome);
      return { status: answer.status, jsonBody: answer.body };
    } catch (err) {
      context.error("POST /subscribers/confirm-sms failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("subscribersResend", {
  route: "subscribers/resend",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const body = (raw ?? {}) as { phone_number?: unknown; email?: unknown };

    const contacts: [Channel, string][] = [];
    if (typeof body.phone_number === "string") {
      const phone = normalizeUsPhone(body.phone_number);
      if (phone) contacts.push(["sms", phone]);
    }
    if (typeof body.email === "string" && body.email.trim()) {
      contacts.push(["email", body.email.trim()]);
    }

    // ONE ANSWER, ALWAYS. Whether a token was issued, whether the rider asked
    // again too soon, and whether the contact exists at all are the same 202.
    // Anything else turns this into a way to ask whether a number or an
    // address is signed up - and, worse, a way to make OnBoard text an
    // arbitrary number on demand.
    const accepted = { status: 202, jsonBody: { status: "sent_if_pending" } };
    if (contacts.length === 0) return accepted;

    try {
      for (const [channel, contact] of contacts) {
        const result = await inTransaction((tx) => requestResend(tx, channel, contact));
        // Published after the commit, so nothing is sent for a token that was
        // rolled back. The reverse - a committed token whose event fails to
        // publish - is the recoverable one: the rider can ask again.
        if (result.outcome === "issued" && result.event) {
          await publishConfirmationRequested(result.event, context);
        }
      }
    } catch (err) {
      // Logged, not surfaced. A rider cannot act on the difference, and the
      // failure mode of saying so is that this endpoint starts answering
      // differently for contacts that exist.
      context.error("POST /subscribers/resend failed:", err);
    }
    return accepted;
  },
});
