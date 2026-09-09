import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { isReferenceDomain, isSystemDomain } from "../lib/assessment/referenceValues";
import { isGuid, validateReferenceValue } from "../lib/validation";

// The vocabulary behind every picker in the standards configurator.
//
// Reads are open to the compliance roles - a manager needs the labels to read
// a scorecard - and every write is OCC.Admin. The guardrail lives here rather
// than in the console: a system-domain value is what the scoring engine
// branches on, so it can be renamed, reordered and retired but never invented
// or destroyed. See lib/assessment/referenceValues.ts for why.

async function referenceReady(pool: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  const check = await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.ReferenceValues','U') IS NULL THEN 0 ELSE 1 END ready`,
  );
  return check.recordset[0]?.ready === 1;
}

app.http("referenceValuesList", {
  route: "reference-values", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      // Before migration 105 the console falls back to its built-in lists, so
      // an unmigrated environment still renders every picker.
      if (!await referenceReady(pool)) return { status: 200, jsonBody: { values: [], diagnostics: { table_ready: false } } };
      const result = await pool.request().query(
        `SELECT * FROM ReferenceValues ORDER BY domain, sort_order, label`,
      );
      return { status: 200, jsonBody: { values: result.recordset, diagnostics: { table_ready: true } } };
    } catch (error) {
      context.error("GET /reference-values failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("referenceValuePut", {
  route: "reference-values/{id}", methods: ["PUT"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid reference value id" } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateReferenceValue(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };

    const pool = await getPool();
    if (!await referenceReady(pool)) return { status: 409, jsonBody: { error: "Migration 105 has not been applied to this database yet" } };
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const existingReq = new sql.Request(tx);
      existingReq.input("id", sql.UniqueIdentifier, id);
      const existing = await existingReq.query<{ domain: string; value: string; is_system: boolean }>(
        `SELECT domain,value,is_system FROM ReferenceValues WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`,
      );
      const row = existing.recordset[0];
      const domain = String(body.domain);

      // Adding to a system domain would create a value the engine has no
      // branch for: computePenalty throws on an unknown basis, and an unknown
      // measurement source has no resolver at all.
      if (!row && isSystemDomain(domain)) {
        await tx.rollback();
        return { status: 409, jsonBody: { error: `${domain} values are what the scoring engine branches on, so a new one cannot be added from here. You can rename, reorder and retire the existing ones.` } };
      }
      // A system row's value is a contract with the code; its label is not.
      if (row?.is_system && (row.domain !== domain || row.value !== String(body.value))) {
        await tx.rollback();
        return { status: 409, jsonBody: { error: `${row.value} is used by the scoring engine and cannot be renamed or moved. Change its label instead — that is what the console shows.` } };
      }

      const write = new sql.Request(tx);
      write.input("id", sql.UniqueIdentifier, id);
      write.input("domain", sql.NVarChar(50), domain);
      write.input("value", sql.NVarChar(50), body.value);
      write.input("label", sql.NVarChar(200), String(body.label).trim());
      write.input("description", sql.NVarChar(500), body.description ?? null);
      write.input("sort", sql.Int, body.sort_order ?? 0);
      write.input("severity", sql.Int, domain === "tier_label" ? body.severity_order ?? null : null);
      write.input("active", sql.Bit, body.is_active !== false);
      // Only an owner is a person; a team, a tier, a category has no account.
      const upn = domain === "assigned_to" && typeof body.principal_upn === "string" && body.principal_upn.trim() ? body.principal_upn.trim().toLowerCase() : null;
      write.input("upn", sql.NVarChar(320), upn);
      write.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      await write.query(`
        MERGE ReferenceValues WITH (HOLDLOCK) target
        USING (SELECT @id id) source ON target.id=source.id
        WHEN MATCHED THEN UPDATE SET label=@label,description=@description,sort_order=@sort,
          severity_order=@severity,is_active=@active,principal_upn=@upn,updated_by=@actor,updated_at=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(id,domain,value,label,description,sort_order,severity_order,is_active,is_system,principal_upn,updated_by)
          VALUES(@id,@domain,@value,@label,@description,@sort,@severity,@active,0,@upn,@actor);
      `);
      await tx.commit();
      return { status: row ? 200 : 201, jsonBody: { id } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
      if (String((error as { message?: string }).message ?? "").includes("UQ_RV_DomainValue")) {
        return { status: 409, jsonBody: { error: `${String(body.value)} already exists in ${String(body.domain)}.` } };
      }
      context.error("PUT /reference-values/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("referenceValueDelete", {
  route: "reference-values/{id}", methods: ["DELETE"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid reference value id" } };
    const pool = await getPool();
    if (!await referenceReady(pool)) return { status: 409, jsonBody: { error: "Migration 105 has not been applied to this database yet" } };
    try {
      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      const existing = await req.query<{ domain: string; value: string; label: string; is_system: boolean }>(
        `SELECT domain,value,label,is_system FROM ReferenceValues WHERE id=@id`,
      );
      const row = existing.recordset[0];
      if (!row) return { status: 404, jsonBody: { error: "Reference value not found" } };
      if (row.is_system) {
        return { status: 409, jsonBody: { error: `${row.value} is used by the scoring engine and cannot be deleted. Retire it instead, which keeps it out of new pickers while everything that already used it still resolves.` } };
      }
      // Deleting an owned value is still narrower than it looks: a standard or
      // a band that already used it has to keep resolving, so a value in use
      // is retired rather than removed.
      const uses = pool.request();
      uses.input("value", sql.NVarChar(50), row.value);
      uses.input("domain", sql.NVarChar(50), row.domain);
      const used = await uses.query<{ used: number }>(`
        SELECT CASE @domain
          WHEN 'unit' THEN (SELECT COUNT(*) FROM ContractorPerformanceStandards WHERE unit_label=@value)
          WHEN 'priority' THEN (SELECT COUNT(*) FROM ContractorPerformanceStandards WHERE priority=@value)
          WHEN 'condition_code' THEN (SELECT COUNT(*) FROM ContractorStandardTiers WHERE qualifier_code=@value)
          WHEN 'source_system' THEN (SELECT COUNT(*) FROM ContractorPerformanceStandards WHERE source_system=@value)
          ELSE 0 END used
      `);
      if (used.recordset[0]?.used) {
        return { status: 409, jsonBody: { error: `${row.label} is used by ${used.recordset[0].used} record${used.recordset[0].used === 1 ? "" : "s"} and cannot be deleted. Retire it instead — it stays out of new pickers while what already used it keeps resolving.` } };
      }
      const purge = pool.request();
      purge.input("id", sql.UniqueIdentifier, id);
      await purge.query(`DELETE FROM ReferenceValues WHERE id=@id`);
      return { status: 200, jsonBody: { id } };
    } catch (error) {
      context.error("DELETE /reference-values/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
