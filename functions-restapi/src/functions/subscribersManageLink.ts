// POST /api/subscribers/manage-link  { phone_number?, email? }
//
// A rider who has lost the link to their own subscription asks for it again.
// Increment D of plans/rider-preference-management-spec.md.
//
// Anonymous, like every rider-facing subscriber endpoint, and so the decisions
// here are about what an anonymous caller may LEARN and CAUSE:
//
//   Learn nothing. Every request - subscribed, unconfirmed, opted out, unknown,
//   asked a moment ago, or failed inside - gets the same answer. A difference
//   would make this a way to ask whether any number or address is signed up.
//
//   Cause little. Only a CONFIRMED channel is ever sent a link (the manage key
//   opens the whole subscription, and handing it to an unproven contact would
//   hand a stranger's subscription to whoever owns an inbox someone typed), and
//   no record is sent one more often than every two minutes (migration 120).
//   Both live in requestManageLink, against the database, not here.
//
// The link is sent by the dispatch app off the confirmation-requested queue,
// told apart from a confirmation by `kind`.
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { getPool, sql } from "../lib/db";
import { publishManageLinkRequested } from "../lib/events";
import { normalizeUsPhone } from "../lib/phone";
import { requestManageLink, type Channel } from "../lib/subscriberPreferences";
import type { ManageLinkRequestedEvent } from "../lib/types";

export interface ManageLinkGateway {
  withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  publish(event: ManageLinkRequestedEvent, context: InvocationContext): Promise<boolean>;
}

const liveGateway: ManageLinkGateway = {
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
  publish: (event, context) => publishManageLinkRequested(event, context),
};

let gateway: ManageLinkGateway = liveGateway;
export function setManageLinkGatewayForTests(replacement: ManageLinkGateway | null): void {
  gateway = replacement ?? liveGateway;
}

/** The one answer. A fresh object each time, so nothing can mutate a shared one. */
function ok(): HttpResponseInit {
  return { status: 200, jsonBody: { status: "ok" } };
}

interface ManageLinkBody {
  phone_number?: unknown;
  email?: unknown;
}

/**
 * The contacts worth looking up, normalized.
 *
 * A number is normalized to E.164 here rather than trusted from the form,
 * because that is how it is stored; a number in any other shape matches
 * nothing. A number that cannot be read is dropped, which answers exactly like
 * a number that is not subscribed.
 */
export function contactsFrom(body: ManageLinkBody): [Channel, string][] {
  const contacts: [Channel, string][] = [];
  if (typeof body.phone_number === "string") {
    const phone = normalizeUsPhone(body.phone_number);
    if (phone) contacts.push(["sms", phone]);
  }
  if (typeof body.email === "string" && body.email.trim()) {
    contacts.push(["email", body.email.trim()]);
  }
  return contacts;
}

export async function requestManageLinkHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  let body: ManageLinkBody;
  try {
    body = ((await request.json()) ?? {}) as ManageLinkBody;
  } catch {
    // Malformed JSON says nothing about any contact, so refusing it is not a
    // disclosure; it is the same 400 every endpoint gives a broken body.
    return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
  }

  for (const [channel, contact] of contactsFrom(body)) {
    try {
      const result = await gateway.withTransaction((tx) => requestManageLink(tx, channel, contact));
      // After the commit, so nothing is sent for a throttle stamp that rolled
      // back. The reverse - stamped but not published - is the recoverable
      // one: the rider asks again in two minutes.
      if (result.outcome === "issued" && result.event) {
        await gateway.publish(result.event, context);
      }
    } catch (err) {
      // Logged by channel, never by contact, and not surfaced: a failure that
      // answered differently would be a difference an attacker could look for.
      context.error(`POST /subscribers/manage-link failed for channel=${channel}:`, err);
    }
  }
  return ok();
}

app.http("subscribersManageLink", {
  route: "subscribers/manage-link",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: requestManageLinkHandler,
});
