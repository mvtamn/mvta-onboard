// The rider's own view of their subscription, and the two things they can do
// to it. Increment B of plans/rider-preference-management-spec.md.
//
//   GET    /api/subscribers/preferences   what they have, and what they may choose
//   PUT    /api/subscribers/preferences   replace it
//   POST   /api/subscribers/unsubscribe   stop everything, and rotate the key
//
// THE KEY TRAVELS IN A HEADER, NEVER IN THE URL. The link mailed to a rider
// points at the rider app, not at this API: the page reads the key out of its
// own query string, strips it from the address bar, and sends it here as
// X-Manage-Key. A key in a request URL is a key in the Function App's request
// telemetry, in Front Door's access logs, and in any referrer - which for a
// credential that never expires is a long time to be written down.
//
// Not `Authorization: Bearer`. Easy Auth is enabled on this app with
// `requireAuthentication: false` / `AllowAnonymous` (functionapp.bicep), and a
// bearer value that is not a JWT is the kind of thing a platform auth layer
// may decide to reject before the function ever runs. A header nothing else
// claims cannot be intercepted by anything.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import {
  resolveManageKey,
  readOptions,
  stateOf,
  maskPhone,
  maskEmail,
  validatePreferenceUpdate,
  writePreferences,
  unsubscribeAll,
  type SubscriberRecord,
  type Channel,
} from "../lib/subscriberPreferences";

const MANAGE_KEY_HEADER = "x-manage-key";

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

// One answer for every way a key can fail to name a subscription: absent,
// malformed, rotated, or naming a record whose merge chain does not end. The
// rider's remedy is the same in all of them - ask for a fresh link - and
// telling them which would say whether a key was ever real.
const NO_SUBSCRIPTION = {
  status: 404,
  jsonBody: { status: "no_subscription" },
};

app.http("subscribersPreferencesGet", {
  route: "subscribers/preferences",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const key = request.headers.get(MANAGE_KEY_HEADER) ?? "";
    try {
      const result = await inTransaction(async (tx) => {
        const record = await resolveManageKey(tx, key);
        if (!record) return null;
        return { record, options: await readOptions(tx) };
      });
      if (!result) return NO_SUBSCRIPTION;

      const { record, options } = result;
      return {
        status: 200,
        jsonBody: {
          // Enough to recognise the subscription, never enough to read the
          // contact off a link someone found.
          phone: maskPhone(record.phone_number),
          email: maskEmail(record.email),
          has_sms: record.sms_status !== null,
          has_email: record.email_status !== null,
          status: record.status,
          ...stateOf(record),
          options,
        },
      };
    } catch (err) {
      context.error("GET /subscribers/preferences failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("subscribersPreferencesPut", {
  route: "subscribers/preferences",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const key = request.headers.get(MANAGE_KEY_HEADER) ?? "";
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const body = (raw ?? {}) as Record<string, unknown>;

    try {
      const outcome = await inTransaction(async (tx) => {
        const record = await resolveManageKey(tx, key);
        if (!record) return { kind: "no_subscription" as const };

        // Validated against what this subscriber was actually offered, read in
        // the same transaction: a route retired from the registry between the
        // GET and the PUT should be refused rather than stored as a value
        // nothing will ever match.
        const options = await readOptions(tx);
        const errors = validatePreferenceUpdate(body, {
          routeIds: options.routes.map((r) => r.id),
          zoneIds: options.zones.map((z) => z.id),
        });
        if (errors.length > 0) return { kind: "invalid" as const, errors };

        const result = await writePreferences(tx, record as SubscriberRecord, {
          categories: body.categories as string[],
          routes: body.routes as string[] | "ALL",
          zones: body.zones as string[] | "ALL",
          channels: body.channels as Channel[],
        });
        return { kind: result };
      });

      switch (outcome.kind) {
        case "no_subscription":
          return NO_SUBSCRIPTION;
        case "invalid":
          return { status: 400, jsonBody: { error: "Validation failed", details: outcome.errors } };
        case "opted_out":
          // Coming back is a new consent, and the date someone agreed is what a
          // TCPA complaint turns on. A click on an old link is not that.
          return { status: 409, jsonBody: { status: "opted_out" } };
        case "channel_stopped":
          // The same rule one channel at a time. The page never sends this - it
          // shows a stopped channel disabled - so only a direct caller reaches
          // it, and is told why instead of the channel being silently left off.
          return {
            status: 400,
            jsonBody: {
              error: "Validation failed",
              details: ["A stopped channel can't be turned back on here. To get those alerts again, sign up again."],
            },
          };
        default:
          return { status: 200, jsonBody: { status: "updated" } };
      }
    } catch (err) {
      context.error("PUT /subscribers/preferences failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("subscribersUnsubscribe", {
  route: "subscribers/unsubscribe",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const key = request.headers.get(MANAGE_KEY_HEADER) ?? "";
    try {
      const done = await inTransaction(async (tx) => {
        const record = await resolveManageKey(tx, key);
        // Already gone is success. A rider who clicks unsubscribe twice, or
        // whose first click rotated the key their second click is still
        // holding, must not be told it failed.
        if (!record) return false;
        await unsubscribeAll(tx, record);
        return true;
      });
      return { status: 200, jsonBody: { status: "unsubscribed", changed: done } };
    } catch (err) {
      context.error("POST /subscribers/unsubscribe failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
