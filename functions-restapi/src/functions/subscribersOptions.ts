// GET /api/subscribers/options - what a rider signing up may choose from.
//
// Backs the route picker on the subscribe form. Anonymous, like every
// rider-facing subscriber endpoint, and it reads nothing about any subscriber:
// the routes are MVTA's public route list and the zones are the active MVTA
// Connect service area.
//
// It answers with the same lists GET /subscribers/preferences carries, from the
// same readOptions, rather than opening the staff route registry at
// GET /api/routes. A route chosen at signup is then one the preference page
// offers afterwards, and POST /subscribers checks it against this same list.
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { readOptions } from "../lib/subscriberPreferences";

export type SubscribeOptions = Awaited<ReturnType<typeof readOptions>>;

export interface SubscribeOptionsGateway {
  read(): Promise<SubscribeOptions>;
}

const liveGateway: SubscribeOptionsGateway = {
  async read() {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const options = await readOptions(tx);
      await tx.commit();
      return options;
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

let gateway: SubscribeOptionsGateway = liveGateway;
export function setSubscribeOptionsGatewayForTests(replacement: SubscribeOptionsGateway | null): void {
  gateway = replacement ?? liveGateway;
}

export async function subscribeOptionsHandler(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const options = await gateway.read();
    return {
      status: 200,
      // The route list changes at a service change, not between page loads.
      // Five minutes spares a busy signup day a GtfsRoutes read per visitor
      // without making a change wait long to show.
      headers: { "Cache-Control": "public, max-age=300" },
      jsonBody: options,
    };
  } catch (err) {
    context.error("GET /subscribers/options failed:", err);
    return { status: 500, jsonBody: { error: "Internal server error" } };
  }
}

app.http("subscribersOptions", {
  route: "subscribers/options",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: subscribeOptionsHandler,
});
