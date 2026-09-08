import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { agreementScope } from "../lib/assessment/schemaScope";
import { isGuid, validateAgreementStandardAssignments, validatePerformanceAgreement } from "../lib/validation";

// Performance agreements, and the standards each one assigns.
//
// Until this endpoint existed there was no way to create an agreement at all:
// migration 032b's INSERT was a one-time backfill guarded by
// NOT EXISTS(SELECT 1 FROM PerformanceAgreements), so a contractor added
// through the console afterwards got no agreement, and then
// complianceCandidatesPoll threw 50002 on every run while assessment periods
// could not be opened. Adding a contractor and giving it an agreement are two
// steps because they are two facts - a contractor outlives any one term - but
// the second step has to be reachable.
//
// Creating an agreement seeds its standard assignments from the agency catalog,
// so a new term starts held to what MVTA scores today and is then edited. The
// seeded rows are ordinary rows; nothing downstream distinguishes them.

// One definition of "migration 102 has run", shared with the period snapshot
// and the tier editor - three places that must agree, or the console would
// offer an assignment the snapshot then ignores.
async function agreementsReady(pool: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  return (await agreementScope(pool)).scoped;
}

app.http("performanceAgreementsList", {
  route: "performance-agreements",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!await agreementsReady(pool)) return { status: 200, jsonBody: { agreements: [], assignments: [], diagnostics: { table_ready: false } } };
      const [agreements, assignments] = await Promise.all([
        pool.request().query(`
          SELECT a.*,c.name contractor_name,
            (SELECT COUNT(*) FROM AgreementStandards ags WHERE ags.agreement_id=a.id AND ags.is_scored=1) scored_standard_count
          FROM PerformanceAgreements a JOIN Contractors c ON c.id=a.contractor_id
          ORDER BY a.is_active DESC, a.starts_on DESC`),
        pool.request().query(`SELECT * FROM AgreementStandards ORDER BY agreement_id, standard_id`),
      ]);
      return { status: 200, jsonBody: { agreements: agreements.recordset, assignments: assignments.recordset, diagnostics: { table_ready: true } } };
    } catch (error) {
      context.error("GET /performance-agreements failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("performanceAgreementPut", {
  route: "performance-agreements/{id}",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid agreement id" } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validatePerformanceAgreement(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };

    const pool = await getPool();
    if (!await agreementsReady(pool)) return { status: 409, jsonBody: { error: "Migration 102 has not been applied to this database yet" } };
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const contractorReq = new sql.Request(tx);
      contractorReq.input("contractor", sql.UniqueIdentifier, body.contractor_id);
      const contractor = await contractorReq.query<{ id: string }>(`SELECT id FROM Contractors WHERE id=@contractor`);
      if (!contractor.recordset[0]) { await tx.rollback(); return { status: 404, jsonBody: { error: "Contractor not found" } }; }

      // UX_PA_ActiveByContractor (migration 102) permits one active agreement
      // per contractor. Stand the other one down first rather than letting the
      // index reject the write with an error nobody can act on.
      if (body.is_active === true) {
        const standDown = new sql.Request(tx);
        standDown.input("contractor", sql.UniqueIdentifier, body.contractor_id);
        standDown.input("id", sql.UniqueIdentifier, id);
        await standDown.query(`UPDATE PerformanceAgreements SET is_active=0 WHERE contractor_id=@contractor AND is_active=1 AND id<>@id`);
      }

      const write = new sql.Request(tx);
      write.input("id", sql.UniqueIdentifier, id);
      write.input("contractor", sql.UniqueIdentifier, body.contractor_id);
      write.input("starts", sql.Char(8), body.starts_on);
      write.input("ends", sql.Char(8), body.ends_on);
      write.input("validation_days", sql.Int, body.validation_business_days);
      write.input("retention", sql.Int, body.retention_years);
      write.input("active", sql.Bit, body.is_active);
      write.input("contract_number", sql.NVarChar(100), body.contract_number ?? null);
      write.input("exhibit_reference", sql.NVarChar(200), body.exhibit_reference ?? null);
      write.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      const result = await write.query<{ created: number }>(`
        DECLARE @existed BIT = CASE WHEN EXISTS(SELECT 1 FROM PerformanceAgreements WHERE id=@id) THEN 1 ELSE 0 END;
        MERGE PerformanceAgreements WITH (HOLDLOCK) target
        USING (SELECT @id id) source ON target.id=source.id
        WHEN MATCHED THEN UPDATE SET contractor_id=@contractor,starts_on=CONVERT(date,@starts,112),ends_on=CONVERT(date,@ends,112),
          validation_business_days=@validation_days,retention_years=@retention,is_active=@active,
          contract_number=@contract_number,exhibit_reference=@exhibit_reference
        WHEN NOT MATCHED THEN INSERT(id,contractor_id,starts_on,ends_on,validation_business_days,retention_years,is_active,contract_number,exhibit_reference,created_by)
          VALUES(@id,@contractor,CONVERT(date,@starts,112),CONVERT(date,@ends,112),@validation_days,@retention,@active,@contract_number,@exhibit_reference,@actor);
        SELECT CONVERT(int, 1 - @existed) created;
      `);
      const created = Boolean(result.recordset[0]?.created);

      if (created) {
        const seed = new sql.Request(tx);
        seed.input("id", sql.UniqueIdentifier, id);
        seed.input("starts", sql.Char(8), body.starts_on);
        seed.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
        await seed.query(`
          INSERT AgreementStandards(agreement_id,standard_id,is_scored,effective_start_date,assignment_note,updated_by)
          SELECT @id,s.id,s.is_scored,@starts,N'Seeded from the agency catalog when the Agreement was created.',@actor
          FROM ContractorPerformanceStandards s
          WHERE NOT EXISTS(SELECT 1 FROM AgreementStandards x WHERE x.agreement_id=@id AND x.standard_id=s.id);
        `);
      }
      await tx.commit();
      return { status: created ? 201 : 200, jsonBody: { id } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
      context.error("PUT /performance-agreements/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("performanceAgreementStandardsPut", {
  route: "performance-agreements/{id}/standards",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid agreement id" } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateAgreementStandardAssignments(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    const assignments = body.assignments as Record<string, unknown>[];

    const pool = await getPool();
    if (!await agreementsReady(pool)) return { status: 409, jsonBody: { error: "Migration 102 has not been applied to this database yet" } };
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const agreementReq = new sql.Request(tx);
      agreementReq.input("id", sql.UniqueIdentifier, id);
      const agreement = await agreementReq.query<{ id: string }>(`SELECT id FROM PerformanceAgreements WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`);
      if (!agreement.recordset[0]) { await tx.rollback(); return { status: 404, jsonBody: { error: "Agreement not found" } }; }

      // Assignments are merged, never deleted. Unassigning is expressed as
      // is_scored=0 or an effective_end_date, because a period that already
      // scored a standard has to keep resolving the row it scored - and
      // because "we stopped holding them to this in June" is itself a fact
      // the assessment record should carry.
      for (const assignment of assignments) {
        const write = new sql.Request(tx);
        write.input("agreement", sql.UniqueIdentifier, id);
        write.input("standard", sql.UniqueIdentifier, assignment.standard_id);
        write.input("scored", sql.Bit, assignment.is_scored);
        write.input("start", sql.Char(8), assignment.effective_start_date);
        write.input("end", sql.Char(8), assignment.effective_end_date ?? null);
        write.input("note", sql.NVarChar(1000), assignment.assignment_note ?? null);
        write.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
        const merged = await write.query<{ matched: number }>(`
          IF NOT EXISTS(SELECT 1 FROM ContractorPerformanceStandards WHERE id=@standard) SELECT CONVERT(int,0) matched;
          ELSE
          BEGIN
            MERGE AgreementStandards WITH (HOLDLOCK) target
            USING (SELECT @agreement agreement_id,@standard standard_id) source
              ON target.agreement_id=source.agreement_id AND target.standard_id=source.standard_id
            WHEN MATCHED THEN UPDATE SET is_scored=@scored,effective_start_date=@start,effective_end_date=@end,
              assignment_note=@note,updated_by=@actor,updated_at=SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT(agreement_id,standard_id,is_scored,effective_start_date,effective_end_date,assignment_note,updated_by)
              VALUES(@agreement,@standard,@scored,@start,@end,@note,@actor);
            SELECT CONVERT(int,1) matched;
          END
        `);
        if (!merged.recordset[0]?.matched) {
          await tx.rollback();
          return { status: 404, jsonBody: { error: `Standard ${String(assignment.standard_id)} not found` } };
        }
      }
      await tx.commit();
      return { status: 200, jsonBody: { id, assignment_count: assignments.length } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
      context.error("PUT /performance-agreements/{id}/standards failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
