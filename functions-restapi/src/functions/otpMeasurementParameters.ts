// The measurement standard fixed-route OTP is polled under, and the provenance
// of the figures already stored (ADR 0042).
//
//   GET  /otp-measurement-parameters  - compliance-review.view
//   POST /otp-measurement-parameters  - service-configuration.edit
//
// Reading is deliberately the weaker permission. Anyone validating a figure -
// Rob working Tier A, an OCC reviewer explaining a month to the contractor -
// has to be able to see what it was measured under; being able to change the
// standard is a different thing entirely.
//
// POST appends a declaration. It does NOT re-pull anything, and that is the
// design rather than an omission: the early threshold rewrites every historical
// compliance figure, so a form that restated years of performance the moment
// somebody saved it is the hazard this module exists to prevent. The response
// says which months are now out of step; a human runs
// POST /otp-historical-backfill for the ones they mean to restate.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import {
  declareParameters,
  monthsNeedingRepull,
  readDeclarationHistory,
  readMonthProvenance,
  readParametersInForce,
  validateParameterSet,
  type DeclareParametersInput,
} from "../lib/otpMeasurementParameters";

const EFFECTIVE_FROM_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateDeclaration(body: Record<string, unknown>): string[] {
  const errors = validateParameterSet(body);
  const effectiveFrom = body.effective_from;
  if (typeof effectiveFrom !== "string" || !EFFECTIVE_FROM_RE.test(effectiveFrom)
      || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) {
    errors.push("effective_from is required and must be a date as YYYY-MM-DD");
  }
  // A declaration with no stated source is the state this ADR is undoing: a
  // standard nobody can trace. There is no API that reports MVTA's BI
  // configuration, so the sentence somebody writes here is the whole evidence.
  if (typeof body.source !== "string" || body.source.trim().length < 3) {
    errors.push("source is required - say where this standard came from, e.g. 'Avail confirmation 2026-10-27'");
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    errors.push("notes must be a string when given");
  }
  return errors;
}

app.http("otpMeasurementParametersGet", {
  route: "otp-measurement-parameters",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "compliance-review.view");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    try {
      const pool = await getPool();
      const inForce = await readParametersInForce(pool);
      const [history, provenance] = await Promise.all([
        readDeclarationHistory(pool),
        readMonthProvenance(pool),
      ]);
      return {
        status: 200,
        jsonBody: {
          in_force: inForce,
          history,
          provenance,
          needs_repull: monthsNeedingRepull(provenance, inForce.segments),
        },
      };
    } catch (err) {
      context.error("GET /otp-measurement-parameters failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("otpMeasurementParametersDeclare", {
  route: "otp-measurement-parameters",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = await requireAccess(request, "service-configuration.edit");
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateDeclaration(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }

    try {
      const pool = await getPool();
      const declaration = await declareParameters(
        pool,
        raw as DeclareParametersInput,
        authResult.principal.userDetails || "system",
      );
      // Read back rather than assuming: a future-dated declaration is not in
      // force yet, and the console must not tell anybody their figures are
      // stale on the strength of a standard that has not started.
      const inForce = await readParametersInForce(pool);
      const provenance = await readMonthProvenance(pool);
      return {
        status: 201,
        jsonBody: {
          declaration,
          in_force: inForce,
          needs_repull: monthsNeedingRepull(provenance, inForce.segments),
        },
      };
    } catch (err) {
      context.error("POST /otp-measurement-parameters failed:", err);
      // The register is the one thing here a missing migration cannot be papered
      // over: a declaration with nowhere to go must fail loudly, not fall back.
      const message = err instanceof Error && /OtpMeasurementParameters/i.test(err.message)
        ? "The measurement parameter register is not available - has migration-151 been run?"
        : "Internal server error";
      return { status: 500, jsonBody: { error: message } };
    }
  },
});
