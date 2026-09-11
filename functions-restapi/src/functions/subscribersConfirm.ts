// The rider-facing end of double opt-in: the three anonymous entry points that
// turn a token we sent into a confirmed channel (increment 3 of
// plans/rider-opt-in-confirmation-loop-spec.md).
//
//   GET  /api/subscribers/confirm-email?token=...   the link in the email
//   POST /api/subscribers/confirm-sms               a code typed into the page
//   POST /api/subscribers/resend                    "send me another one"
//
// All three are anonymous, because the person using them is a rider with no
// account. The decisions below are mostly about what an anonymous caller is
// allowed to LEARN, which is a different question from what they are allowed
// to do, and the more dangerous one here: `Subscribers` rows are phone numbers
// and email addresses, and an endpoint that answers different things for a
// subscribed contact and an unsubscribed one is a membership oracle for anyone
// who can type numbers into it.
//
// The state machine itself is lib/subscriberConfirmation.ts. This file is the
// HTTP shell around it: parse, normalize, call, and decide what to say.
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { getPool, sql } from "../lib/db";
import { publishConfirmationRequested } from "../lib/events";
import { normalizeUsPhone } from "../lib/phone";
import {
  confirmEmail,
  confirmSms,
  resendConfirmation,
  type Channel,
  type ConfirmOutcome,
} from "../lib/subscriberConfirmation";
import type { ConfirmationRequestedEvent } from "../lib/types";

// What the rider's landing page is told. Deliberately smaller than
// ConfirmOutcome: several internal outcomes have the same remedy, and the
// landing page has to write a sentence for each of these.
export type PublicStatus =
  | "confirmed"
  | "already_confirmed"
  | "superseded"
  | "expired"
  | "opted_out"
  | "invalid";

/**
 * The email link's outcome, as the rider is told it.
 *
 * Everything the rider can act on is kept - the remedy for `expired` is a
 * resend and the remedy for `opted_out` is to subscribe again, and telling
 * someone holding a real link "that did not work" would be both unhelpful and
 * untrue.
 *
 * This is safe HERE and not on the SMS path below, and the difference is the
 * credential. To reach this function you must hold a 24-byte token we mailed
 * to the address in question; whatever it tells you, you already had proof of
 * that address. The SMS path takes a phone number in a request body, which
 * anybody can type.
 */
export function emailStatus(outcome: ConfirmOutcome): PublicStatus {
  switch (outcome) {
    case "confirmed":
      return "confirmed";
    case "already_confirmed":
      return "already_confirmed";
    case "superseded":
      return "superseded";
    case "expired":
      return "expired";
    case "opted_out":
      return "opted_out";
    // not_found is a token that never existed or was typed wrong;
    // incorrect_code and too_many_attempts cannot arise on a token-keyed
    // lookup. All read as a link that does not work, which is what it is.
    default:
      return "invalid";
  }
}

/**
 * The SMS code's outcome, as an arbitrary caller is told it.
 *
 * ONLY "confirmed" SURVIVES. Every refusal collapses to one answer, including
 * the ones the rider would find informative, because this endpoint's input is
 * a phone number rather than a secret: distinguishing "no live confirmation
 * for that number" from "wrong code" from "too many attempts" would answer,
 * for any number anyone cares to type, whether it is subscribed and whether it
 * is mid-signup. `already_confirmed` leaks the same fact and is the one that
 * looks most harmless, since `confirmSms` reaches it without checking the code
 * at all.
 *
 * The cost is a rider who has genuinely run out of attempts being told only
 * that the code did not work. The landing page's copy carries the remedy that
 * covers every case - check the code, or ask for a new one - so the rider is
 * not stuck, and the resend below issues a token that clears the cap.
 *
 * lib/subscriberConfirmation.ts returns the full outcome on purpose: the
 * inbound-SMS path (increment 5) has the sender's number proven by the carrier
 * and can safely say more. Collapsing is this caller's job, not the module's.
 */
export function smsStatus(outcome: ConfirmOutcome): "confirmed" | "invalid" {
  return outcome === "confirmed" ? "confirmed" : "invalid";
}

/**
 * Where to send the rider after the email link.
 *
 * RIDER_APP_BASE_URL when it is set, and a same-host path when it is not. The
 * fallback is correct rather than merely tolerable: the link the rider clicked
 * was built from that same base, so /api and the rider app are being served
 * from one host, and a relative Location lands on the app. A missing setting
 * should not turn a working confirmation into a dead end.
 *
 * The token never appears here. It is a live credential until the moment it is
 * spent, and a query string travels into browser history, Referer headers and
 * any analytics the landing page carries.
 */
export function confirmedUrl(base: string | undefined, status: PublicStatus, channel: Channel): string {
  const root = (base ?? "").replace(/\/+$/, "");
  return `${root}/subscribe/confirmed?status=${status}&channel=${channel}`;
}

// The database and the queue, behind a seam, so the handlers can be tested
// without either.
export interface ConfirmGateway {
  withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  publish(event: ConfirmationRequestedEvent, context: InvocationContext): Promise<boolean>;
}

const liveGateway: ConfirmGateway = {
  async withTransaction(run) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const result = await run(tx);
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
  },
  publish: (event, context) => publishConfirmationRequested(event, context),
};

let gateway: ConfirmGateway = liveGateway;
export function setConfirmGatewayForTests(replacement: ConfirmGateway | null): void {
  gateway = replacement ?? liveGateway;
}

function redirect(status: PublicStatus, channel: Channel): HttpResponseInit {
  return {
    status: 302,
    headers: {
      Location: confirmedUrl(process.env.RIDER_APP_BASE_URL, status, channel),
      // The outcome is about one token and one rider. A cached 302 would send
      // the next person down the same branch.
      "Cache-Control": "no-store",
    },
  };
}

/**
 * GET /api/subscribers/confirm-email?token=...
 *
 * A state change on a GET, which is correct in exactly this one place: the
 * rider's click IS the request and there is no opportunity to POST. What makes
 * it acceptable is that the token is single-use and expires. The known
 * consequence is that a mail scanner which prefetches links will confirm the
 * subscription on the rider's behalf - the standard trade for emailed
 * confirmation links, and the reason the SMS channel uses a code that has to
 * be typed.
 *
 * Always a redirect, never a JSON body: the caller is a browser the rider is
 * looking at, and every outcome including failure has something to say to
 * them. The URL is the one already baked into dispatchConfirmation and into
 * any confirmation email already sitting in an inbox, so it cannot change.
 */
export async function confirmEmailLink(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const token = request.query.get("token");
  if (!token) return redirect("invalid", "email");

  try {
    const result = await gateway.withTransaction((tx) => confirmEmail(tx, token));
    return redirect(emailStatus(result.outcome), "email");
  } catch (err) {
    context.error("GET /subscribers/confirm-email failed:", err);
    // A 500 page is the worst possible answer to someone who did everything
    // right; the landing page can at least offer a resend.
    return redirect("invalid", "email");
  }
}

interface SmsBody {
  phone_number?: unknown;
  code?: unknown;
}

/**
 * POST /api/subscribers/confirm-sms  { phone_number, code }
 *
 * For a rider who would rather type the code into the page than reply to the
 * text - and, until a toll-free number is verified and the inbound handler
 * exists (increment 5), the only way an SMS channel can be confirmed at all.
 *
 * The number is normalized here and not trusted from the form: it is stored in
 * E.164, and a number in any other shape matches nothing, which is
 * indistinguishable from never having subscribed.
 */
export async function confirmSmsCode(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: SmsBody;
  try {
    body = (await request.json()) as SmsBody;
  } catch {
    return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  }
  if (typeof body?.phone_number !== "string" || typeof body?.code !== "string") {
    return { status: 400, jsonBody: { error: "phone_number and code are required" } };
  }

  const phone = normalizeUsPhone(body.phone_number);
  const code = body.code.trim();
  // A number that is not a number, and a code that is not six digits, cannot
  // match any row. Answering without a query keeps the shape of the answer
  // identical to a wrong code, which is the point.
  if (!phone || !/^\d{6}$/.test(code)) {
    return { status: 200, jsonBody: { status: "invalid" } };
  }

  try {
    const result = await gateway.withTransaction((tx) => confirmSms(tx, phone, code));
    return { status: 200, jsonBody: { status: smsStatus(result.outcome), channel: "sms" } };
  } catch (err) {
    context.error("POST /subscribers/confirm-sms failed:", err);
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}

interface ResendBody {
  phone_number?: unknown;
  email?: unknown;
}

/**
 * POST /api/subscribers/resend  { phone_number?, email? }
 *
 * ALWAYS ANSWERS THE SAME. Whether the contact exists, is already confirmed,
 * asked two seconds ago, or was never heard of, the answer is `{ status: "ok"
 * }`. Any difference between those would make this the membership oracle that
 * confirm-sms is careful not to be - and this one would not even need a code.
 *
 * The rate limit that makes this safe to expose is inside
 * `resendConfirmation`, where it is enforced against the database rather than
 * against anything the caller controls.
 */
export async function resendConfirmationRequest(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: ResendBody;
  try {
    body = (await request.json()) as ResendBody;
  } catch {
    return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  }

  const targets: { channel: Channel; contact: string }[] = [];
  if (typeof body?.phone_number === "string" && body.phone_number.trim() !== "") {
    const phone = normalizeUsPhone(body.phone_number);
    if (phone) targets.push({ channel: "sms", contact: phone });
  }
  if (typeof body?.email === "string" && body.email.trim() !== "") {
    // Trimmed, not lower-cased: the opt-in form stores the address as the
    // rider typed it, so folding the case here would be a transformation the
    // stored value never had.
    targets.push({ channel: "email", contact: body.email.trim() });
  }
  if (targets.length === 0) {
    // Nothing usable to send to. Still the ordinary answer: "you gave me
    // neither" and "I will not tell you" must not be distinguishable either.
    return { status: 200, jsonBody: { status: "ok" } };
  }

  try {
    for (const target of targets) {
      // One transaction per channel. Two channels are two independent
      // requests, and a failure to reissue the email token should not roll
      // back an SMS token that was successfully issued and is about to be sent.
      const result = await gateway.withTransaction((tx) =>
        resendConfirmation(tx, target.channel, target.contact, context),
      );
      if (result.outcome !== "issued" || !result.issued) continue;

      // Published after the commit, like the opt-in path: the token has to
      // exist before anything can be sent for it.
      await gateway.publish(
        {
          confirmation_id: result.issued.confirmation_id,
          subscriber_id: result.subscriberId!,
          channel: target.channel,
          token: result.issued.token,
          phone_number: target.channel === "sms" ? target.contact : null,
          email: target.channel === "email" ? target.contact : null,
        },
        context,
      );
    }
  } catch (err) {
    // Logged, not reported. A rider learning that their resend failed for an
    // internal reason is no better off, and an error that only appears for
    // contacts that exist is the oracle again.
    context.error("POST /subscribers/resend failed:", err);
  }

  return { status: 200, jsonBody: { status: "ok" } };
}

app.http("subscribersConfirmEmail", {
  route: "subscribers/confirm-email",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: confirmEmailLink,
});

app.http("subscribersConfirmSms", {
  route: "subscribers/confirm-sms",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: confirmSmsCode,
});

app.http("subscribersResend", {
  route: "subscribers/resend",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: resendConfirmationRequest,
});
