import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isGuid, isServiceDate } from "../lib/validation";

app.http("contractorsList", {
  route: "contractors",
  methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const check = await pool.request().query<{ ready: number }>(`SELECT CASE WHEN OBJECT_ID('dbo.Contractors','U') IS NULL THEN 0 ELSE 1 END ready`);
      if (!check.recordset[0]?.ready) return { status: 200, jsonBody: { contractors: [], diagnostics: { table_ready: false } } };
      const result = await pool.request().query(`SELECT * FROM Contractors ORDER BY is_active DESC, name`);
      return { status: 200, jsonBody: { contractors: result.recordset, diagnostics: { table_ready: true } } };
    } catch (error) {
      context.error("GET /contractors failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("contractorsPut", {
  route: "contractors/{id}",
  methods: ["PUT"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    if (!isGuid(id) || typeof body.name !== "string" || !isServiceDate(body.contract_start_date)) {
      return { status: 400, jsonBody: { error: "id, name, and contract_start_date (YYYYMMDD) are required" } };
    }
    if (body.contract_end_date !== null && body.contract_end_date !== undefined && !isServiceDate(body.contract_end_date)) {
      return { status: 400, jsonBody: { error: "contract_end_date must be YYYYMMDD or null" } };
    }
    try {
      const pool = await getPool();
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("name", sql.NVarChar(200), body.name.trim());
      req.input("start", sql.Char(8), body.contract_start_date);
      req.input("end", sql.Char(8), body.contract_end_date ?? null);
      req.input("active", sql.Bit, body.is_active !== false);
      req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      await req.query(`
        MERGE Contractors WITH (HOLDLOCK) target
        USING (SELECT @id id) source ON target.id=source.id
        WHEN MATCHED THEN UPDATE SET name=@name, contract_start_date=@start, contract_end_date=@end, is_active=@active, updated_by=@actor, updated_at=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(id,name,contract_start_date,contract_end_date,is_active,updated_by) VALUES(@id,@name,@start,@end,@active,@actor);
      `);
      return { status: 200, jsonBody: { id } };
    } catch (error) {
      context.error("PUT /contractors/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
