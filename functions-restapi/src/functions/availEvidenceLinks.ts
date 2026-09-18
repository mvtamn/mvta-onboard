// The Avail links waiting on a reviewer.
//
//   GET  /avail-evidence-links      - compliance-review.view
//   POST /avail-evidence-links/{id} - compliance-review.review
//
// A probable link is one Avail record that could be about more than one case,
// or carried no start time. The adapter refuses to guess (ADR-0035), so a
// person names the case or says the record is not about any of them. Confirming
// is what makes the record corroborate the case; until then it changes nothing.
//
// Retracted links are listed alongside them: Avail restates its window nightly,
// so a record it stops reporting is corroboration being withdrawn from a case
// that may already have been reviewed on the strength of it.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { outstandingAvailLinks, resolveAvailLink } from "../lib/missedTripCase/adapters/availLinks";

app.http("availEvidenceLinksList", {
  route: "avail-evidence-links",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const access = await requireAccess(request, "compliance-review.view");
    if (!access.authorized) return { status: access.status, jsonBody: { error: access.message } };
    try {
      const links = await outstandingAvailLinks(await getPool());
      return {
        status: 200,
        jsonBody: {
          probable: links.filter((l) => l.resolution === null && l.retracted_at === null),
          retracted: links.filter((l) => l.retracted_at !== null),
        },
      };
    } catch (err) {
      context.error("GET /avail-evidence-links failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("availEvidenceLinkResolve", {
  route: "avail-evidence-links/{id}",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const access = await requireAccess(request, "compliance-review.review");
    if (!access.authorized) return { status: access.status, jsonBody: { error: access.message } };
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return { status: 400, jsonBody: { error: "That is not a link id." } };
    }
    let body: { decision?: string; trip_id?: string; service_date?: string; note?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    if (body.decision !== "confirmed" && body.decision !== "rejected") {
      return { status: 400, jsonBody: { error: "Say whether this link is confirmed or rejected." } };
    }
    try {
      const outcome = await resolveAvailLink(await getPool(), {
        id,
        decision: body.decision,
        tripId: body.trip_id ?? null,
        serviceDate: body.service_date ?? null,
        note: body.note ?? null,
        actor: access.principal.userDetails || "system",
      });
      if (!outcome.ok) {
        return { status: outcome.refusal === "not_found" ? 404 : 409, jsonBody: { error: outcome.sentence, code: outcome.refusal } };
      }
      return { status: 200, jsonBody: outcome.link };
    } catch (err) {
      context.error("POST /avail-evidence-links failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
