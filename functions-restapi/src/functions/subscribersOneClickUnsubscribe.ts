// POST /api/subscribers/one-click-unsubscribe?d=<delivery id>
//
// The target of the List-Unsubscribe header on every rider alert email
// (RFC 8058). Gmail, Yahoo and Outlook show an Unsubscribe button beside the
// sender and, when it is pressed, POST `List-Unsubscribe=One-Click` here
// themselves - no page, no rider in front of it, no manage key.
//
// THE CREDENTIAL IS THE DELIVERY ID. `d` is the EmailDeliveryLog row of the
// email that carried the header: a random UUID dispatchMessageCreated chose
// before sending, which only that email's recipient was ever given. It sits in
// the query string, so it reaches access logs, and that is acceptable because
// of how little it can do: stop email to the address that email went to.
// Nothing else - not SMS, not preferences, not reading anything back.
//
// ALWAYS ANSWERS THE SAME, like /subscribers/resend: an id that matched, one
// that did not, and an email already stopped are indistinguishable, so the
// endpoint cannot be used to learn anything.
//
// Scope is the channel, through optOut: a rider who stops the emails keeps
// the texts they signed up for.
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { getPool, sql } from "../lib/db";
import { optOut } from "../lib/subscriberConfirmation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address the delivery went to, or null if no such delivery. */
export async function addressForDelivery(tx: Transaction, deliveryId: string): Promise<string | null> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, deliveryId);
  const { recordset } = await req.query<{ email: string | null }>(
    `SELECT s.email
       FROM EmailDeliveryLog l
       JOIN Subscribers s ON s.subscriber_id = l.subscriber_id
      WHERE l.log_id = @id`,
  );
  return recordset[0]?.email ?? null;
}

// The database behind a seam, so the handler's decisions can be tested
// without one. `stop` returns whether an address was found.
export interface OneClickGateway {
  stop(deliveryId: string): Promise<boolean>;
}

const liveGateway: OneClickGateway = {
  async stop(deliveryId) {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const email = await addressForDelivery(tx, deliveryId);
      // A merged subscriber's log rows still name the merged record; optOut
      // matches on the address across live records, so it reaches the
      // survivor.
      if (email) await optOut(tx, "email", email, "email_link");
      await tx.commit();
      return email !== null;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      throw err;
    }
  },
};

let gateway: OneClickGateway = liveGateway;
export function setOneClickGatewayForTests(replacement: OneClickGateway | null): void {
  gateway = replacement ?? liveGateway;
}

const OK: HttpResponseInit = { status: 200, jsonBody: { status: "ok" }, headers: { "Cache-Control": "no-store" } };

export async function oneClickUnsubscribe(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const id = request.query.get("d") ?? "";
  // The body is not checked. RFC 8058 says the client sends
  // `List-Unsubscribe=One-Click`, but refusing one that did not would only
  // keep sending email to someone who pressed Unsubscribe.
  if (!UUID.test(id)) return OK;
  try {
    const found = await gateway.stop(id);
    // Logged by delivery id only: the address is not needed to trace it.
    context.log(`One-click unsubscribe for delivery ${id}: ${found ? "email stopped" : "no such delivery"}`);
  } catch (err) {
    // Still OK to the caller - a mail provider retrying, or a person shown an
    // error, gains nothing - but logged so a real outage is seen.
    context.error("POST /subscribers/one-click-unsubscribe failed:", err);
  }
  return OK;
}

app.http("subscribersOneClickUnsubscribe", {
  route: "subscribers/one-click-unsubscribe",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: oneClickUnsubscribe,
});
