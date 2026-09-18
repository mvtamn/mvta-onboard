// GET /me/access - the caller's own Effective Access.
//
// One answer the console reads instead of keeping its own role lists: which
// modules to show, which controls to enable, and the plain-English summary of
// what the person holds. Those lists drifted from the API's while both sides
// read app roles from the token, which is how Compliance Manager came to open
// a page whose data calls refused it (ADR-0032).
//
//   GET /me/access - any signed-in caller; roles decide the contents, not the
//   right to ask. A caller with no grants gets an empty list, which the console
//   shows as the No access page.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getCallerPrincipal } from "../lib/auth";
import { resolveEffectiveAccess } from "../lib/access";

app.http("meAccess", {
  route: "me/access",
  methods: ["GET"],
  authLevel: "anonymous", // authorization is the answer itself; see below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const principal = getCallerPrincipal(request);
    if (!principal) {
      return { status: 401, jsonBody: { error: "Not authenticated." } };
    }
    try {
      const access = await resolveEffectiveAccess(principal);
      return { status: 200, jsonBody: access };
    } catch (error) {
      context.error("meAccess failed", error);
      // Never fall back to "no access looks like no roles": the console would
      // silently show a signed-in person an empty app.
      return { status: 503, jsonBody: { error: "Access could not be resolved." } };
    }
  },
});
