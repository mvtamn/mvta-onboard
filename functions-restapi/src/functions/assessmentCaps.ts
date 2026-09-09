import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { auditSql } from "../lib/assessment/audit";
import { capTransition, type CapStatus } from "../lib/assessment/capTransitions";
import { COMPLIANCE_MANAGER_ROLES, COMPLIANCE_WRITE_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid } from "../lib/validation";

const STATUSES: readonly CapStatus[] = ["required", "submitted", "approved", "in_progress", "closed", "failed"];

// One transition per call. The rule set lives in lib/assessment/capTransitions;
// this handler binds the caller's role, reads the plan's current status under
// a lock, and writes the fields the step requires plus its timestamp.
app.http("assessmentCapTransition", {
  route: "assessment-caps/{id}", methods: ["PATCH"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    if (!isGuid(request.params.id)) return { status: 400, jsonBody: { error: "Invalid CAP id" } };
    let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const to = String(body.status) as CapStatus;
    if (!STATUSES.includes(to)) return { status: 400, jsonBody: { error: `status must be one of ${STATUSES.join(", ")}` } };
    const role = auth.principal.roles.some(r => COMPLIANCE_MANAGER_ROLES.includes(r)) ? "manager" : "writer";
    const actor = auth.principal.userDetails ?? "onboard-console";
    const pool = await getPool(); const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const read = new sql.Request(tx); read.input("id", sql.UniqueIdentifier, request.params.id);
      const current = (await read.query<{ status: CapStatus }>(`SELECT status FROM CorrectiveActionPlans WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`)).recordset[0];
      if (!current) { await tx.rollback(); return { status: 404, jsonBody: { error: "Corrective Action Plan not found" } }; }
      const decision = capTransition(current.status, to, role, body);
      if (!decision.ok) { await tx.rollback(); return { status: 409, jsonBody: { error: decision.error } }; }
      const write = new sql.Request(tx);
      write.input("id", sql.UniqueIdentifier, request.params.id); write.input("to", sql.NVarChar(20), to); write.input("actor", sql.NVarChar(200), actor); write.input("from", sql.NVarChar(20), current.status);
      // Field names come from the rule table, never the body; values are bound.
      const assignments = decision.sets.map(f => { write.input(f, sql.NVarChar(sql.MAX), String(body[f])); return `${f}=@${f}`; });
      if (decision.stamps) assignments.push(`${decision.stamps}=SYSUTCDATETIME()`);
      if (decision.clears) assignments.push(`${decision.clears}=NULL`);
      write.input("note", sql.NVarChar(1000), decision.note ? String(body.note) : decision.sets.includes("closure_note") ? String(body.closure_note) : null);
      await write.query(`UPDATE CorrectiveActionPlans SET status=@to${assignments.length ? "," + assignments.join(",") : ""} WHERE id=@id;${auditSql("cap", "@id", "cap_transitioned", "actor", { after: "(SELECT @from [from],@to [to] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)", note: "@note" })}`);
      await tx.commit();
      return { status: 200, jsonBody: { id: request.params.id, status: to } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* completed */ }
      context.error("PATCH assessment CAP failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

