import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";

app.http("decisionMatrixGovernance", {
  route: "admin/decision-matrix/{procedureId}/{revision}",
  methods: ["PATCH"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const procedureId = request.params.procedureId;
    const revision = Number(request.params.revision);
    if (!procedureId || !Number.isInteger(revision)) return { status: 400, jsonBody: { error: "procedureId and integer revision are required" } };
    let body: { action?: unknown; reason?: unknown };
    try { body = await request.json() as typeof body; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const action = body.action;
    if (action !== "approve" && action !== "retire") return { status: 400, jsonBody: { error: "action must be approve or retire" } };
    try {
      const pool = await getPool();
      const lookup = pool.request();
      lookup.input("procedure_id", sql.NVarChar, procedureId);
      lookup.input("revision", sql.Int, revision);
      const existing = await lookup.query<{ approval_state: string }>(`SELECT approval_state FROM DecisionMatrixProcedures WHERE procedure_id=@procedure_id AND revision=@revision`);
      if (!existing.recordset[0]) return { status: 404, jsonBody: { error: "Procedure revision not found" } };
      const update = pool.request();
      update.input("procedure_id", sql.NVarChar, procedureId);
      update.input("revision", sql.Int, revision);
      update.input("actor", sql.NVarChar, auth.principal.userDetails || "OCC Admin");
      update.input("reason", sql.NVarChar, typeof body.reason === "string" ? body.reason : null);
      const result = await update.query(`
        UPDATE DecisionMatrixProcedures
        SET approval_state = ${action === "approve" ? "'Approved'" : "'Retired'"},
            trust_state = ${action === "approve" ? "'Approved'" : "'Retired'"},
            retired_at = ${action === "approve" ? "NULL" : "SYSUTCDATETIME()"},
            approver = CASE WHEN ${action === "approve" ? "1" : "0"} = 1 THEN @actor ELSE approver END,
            updated_by = @actor, updated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.procedure_id, INSERTED.revision, INSERTED.approval_state,
               INSERTED.trust_state, INSERTED.updated_at
        WHERE procedure_id=@procedure_id AND revision=@revision
      `);
      context.log(`Decision Matrix revision ${procedureId}/${revision} ${action} by ${auth.principal.userDetails || "unknown"}: ${body.reason || "no reason"}`);
      return { status: 200, jsonBody: result.recordset[0] };
    } catch (error) {
      context.error("Decision Matrix governance action failed", error);
      return { status: 500, jsonBody: { error: "Governance action failed." } };
    }
  },
});
