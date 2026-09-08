import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ADMIN_ROLES, COMPLIANCE_READ_ROLES, requireRole } from "../lib/auth";
import { getPool, sql } from "../lib/db";
import { RESOLVERS } from "../lib/assessment/resolvers";
import { KNOWN_SOURCE_SYSTEMS } from "../lib/assessment/measurementSource";
import { agreementScope } from "../lib/assessment/schemaScope";
import { isGuid, validatePerformanceStandard, validateStandardTierLadder } from "../lib/validation";

// The Attachment G standards catalog and its tier ladders.
//
// Attachment G reserves the right to amend a threshold by contract amendment,
// so the bands have to be editable data rather than a migration. Reads are open
// to the compliance roles - a manager reviewing a scorecard needs to see the
// band that produced it - and every write is OCC.Admin.
//
// Scoping (migration 102): the catalog is the agency's library. An agreement
// says which of those standards a contractor is actually held to, and may carry
// its own tier ladder. A tier row with agreement_id NULL is the catalog default.

interface StandardRow { id: string; code: string }

app.http("performanceStandardsList", {
  route: "performance-standards",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, COMPLIANCE_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ContractorPerformanceStandards','U') IS NULL THEN 0 ELSE 1 END ready
      `);
      if (!ready.recordset[0]?.ready) {
        return { status: 200, jsonBody: { standards: [], tiers: [], agreements: [], assignments: [], resolvers: [], source_systems: [], diagnostics: { table_ready: false, assignments_ready: false } } };
      }
      // Migration 102 may not have run yet; the catalog still reads correctly
      // without it, so the page degrades to the agency-wide view rather than
      // failing. diagnostics.assignments_ready is what the console keys on, and
      // it comes from the same helper the tier editor and the period snapshot
      // use - a half-applied migration must not let the page offer an edit the
      // write path then refuses.
      const assignmentsReady = (await agreementScope(pool)).scoped;
      const [standards, tiers, agreements, assignments] = await Promise.all([
        pool.request().query(`SELECT * FROM ContractorPerformanceStandards ORDER BY sort_order`),
        pool.request().query(`SELECT * FROM ContractorStandardTiers ORDER BY standard_id, tier_order`),
        assignmentsReady
          ? pool.request().query(`SELECT a.*,c.name contractor_name FROM PerformanceAgreements a JOIN Contractors c ON c.id=a.contractor_id ORDER BY a.is_active DESC, a.starts_on DESC`)
          : Promise.resolve({ recordset: [] }),
        assignmentsReady
          ? pool.request().query(`SELECT * FROM AgreementStandards ORDER BY agreement_id, standard_id`)
          : Promise.resolve({ recordset: [] }),
      ]);
      return {
        status: 200,
        jsonBody: {
          standards: standards.recordset, tiers: tiers.recordset,
          agreements: agreements.recordset, assignments: assignments.recordset,
          // The registry, so the console offers the keys the compute answers
          // to rather than a text box. Served from code, not from the
          // database: it is the set of resolvers this deployment has, which is
          // exactly what a saved resolver_key has to match.
          resolvers: RESOLVERS.map(({ key, label, description, appliesTo, source }) => ({ key, label, description, applies_to: appliesTo, source })),
          source_systems: KNOWN_SOURCE_SYSTEMS.map(({ value, label, description }) => ({ value, label, description })),
          diagnostics: { table_ready: true, assignments_ready: assignmentsReady },
        },
      };
    } catch (error) {
      context.error("GET /performance-standards failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("performanceStandardPut", {
  route: "performance-standards/{id}",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid standard id" } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validatePerformanceStandard(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    try {
      const pool = await getPool();
      const existing = await (() => { const req = pool.request(); req.input("id", sql.UniqueIdentifier, id); return req.query<StandardRow>(`SELECT id,code FROM ContractorPerformanceStandards WHERE id=@id`); })();
      // A standard's code is a public identifier: resolvers, the candidate poll
      // and migration 088a's dismissal rule all match on the literal string.
      // Renaming one would silently detach it from its own measurements, so an
      // existing standard keeps the code it was created with.
      if (existing.recordset[0] && existing.recordset[0].code !== body.code) {
        return { status: 409, jsonBody: { error: `This standard's code is ${existing.recordset[0].code} and cannot be changed. Retire it with an effective_end_date and add a new standard instead.` } };
      }
      const duplicate = await (() => { const req = pool.request(); req.input("code", sql.NVarChar(50), body.code); req.input("id", sql.UniqueIdentifier, id); return req.query<{ id: string }>(`SELECT id FROM ContractorPerformanceStandards WHERE code=@code AND id<>@id`); })();
      if (duplicate.recordset[0]) return { status: 409, jsonBody: { error: `Standard code ${String(body.code)} is already in use` } };

      const req = pool.request();
      req.input("id", sql.UniqueIdentifier, id);
      req.input("code", sql.NVarChar(50), body.code);
      req.input("name", sql.NVarChar(200), String(body.name).trim());
      req.input("description", sql.NVarChar(2000), body.description ?? null);
      req.input("type", sql.NVarChar(20), body.standard_type);
      req.input("priority", sql.NVarChar(10), body.priority);
      req.input("scored", sql.Bit, body.is_scored);
      req.input("safety", sql.Bit, body.is_safety_critical);
      req.input("direction", sql.NVarChar(30), body.direction);
      req.input("unit", sql.NVarChar(50), String(body.unit_label).trim());
      req.input("source", sql.NVarChar(20), body.measurement_source);
      req.input("resolver", sql.NVarChar(50), body.resolver_key ?? null);
      req.input("source_system", sql.NVarChar(100), body.source_system ?? null);
      req.input("data_note", sql.NVarChar(1000), body.data_source_note ?? null);
      req.input("team", sql.NVarChar(200), body.responsible_team ?? null);
      req.input("assigned", sql.NVarChar(200), body.assigned_to ?? null);
      req.input("cap_note", sql.NVarChar(1000), body.cap_rule_note ?? null);
      // The corrective-action window only exists in a database that has had
      // migrations 107 and 109. Naming a column the schema lacks fails at parse
      // time and takes the whole MERGE with it, so the columns are composed in
      // rather than bound unconditionally. The scope flags read the snapshot
      // tables those same migrations alter, which move together with the
      // catalog's own columns.
      const scope = await agreementScope(pool);
      const capMode = scope.windowModes ? (body.cap_window_mode ?? null) : null;
      const capThreshold = scope.penaltyScaling && body.cap_window_mode ? (body.cap_window_threshold ?? null) : null;
      const capDays = scope.penaltyScaling && body.cap_window_mode === "rolling_days" ? (body.cap_window_days ?? null) : null;
      if (scope.penaltyScaling) {
        req.input("cap_threshold", sql.Int, capThreshold);
        req.input("cap_days", sql.Int, capDays);
      }
      if (scope.windowModes) req.input("cap_mode", sql.NVarChar(20), capMode);
      // Same reason as the window: a column the schema lacks fails the MERGE at
      // parse time, so category is composed in rather than bound outright.
      if (scope.categorised) req.input("category", sql.NVarChar(50), body.category ?? null);
      if (scope.penaltyScaling) {
        req.input("target_value", sql.Float, typeof body.target_value === "number" ? body.target_value : null);
        req.input("target_display", sql.NVarChar(100), body.target_display ?? null);
        // NOT NULL with a default in migration 107, so an omitted scope means
        // per_occurrence rather than a null the column will not take.
        req.input("band_scope", sql.NVarChar(20), body.band_scope === "running_count" ? "running_count" : "per_occurrence");
      }
      const guardedSet = [
        scope.penaltyScaling ? "cap_window_threshold=@cap_threshold,cap_window_days=@cap_days,target_value=@target_value,target_display=@target_display,band_scope=@band_scope" : "",
        scope.windowModes ? "cap_window_mode=@cap_mode" : "",
        scope.categorised ? "category=@category" : "",
      ].filter(Boolean).join(",");
      const guardedColumns = [
        scope.penaltyScaling ? "cap_window_threshold,cap_window_days,target_value,target_display,band_scope" : "",
        scope.windowModes ? "cap_window_mode" : "",
        scope.categorised ? "category" : "",
      ].filter(Boolean).join(",");
      const guardedValues = [
        scope.penaltyScaling ? "@cap_threshold,@cap_days,@target_value,@target_display,@band_scope" : "",
        scope.windowModes ? "@cap_mode" : "",
        scope.categorised ? "@category" : "",
      ].filter(Boolean).join(",");
      req.input("sort", sql.Int, body.sort_order);
      req.input("start", sql.Char(8), body.effective_start_date);
      req.input("end", sql.Char(8), body.effective_end_date ?? null);
      req.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
      await req.query(`
        MERGE ContractorPerformanceStandards WITH (HOLDLOCK) target
        USING (SELECT @id id) source ON target.id=source.id
        WHEN MATCHED THEN UPDATE SET name=@name,description=@description,standard_type=@type,priority=@priority,
          is_scored=@scored,is_safety_critical=@safety,direction=@direction,unit_label=@unit,measurement_source=@source,
          resolver_key=@resolver,source_system=@source_system,data_source_note=@data_note,responsible_team=@team,assigned_to=@assigned,
          cap_rule_note=@cap_note,sort_order=@sort,effective_start_date=@start,effective_end_date=@end,
          ${guardedSet ? `${guardedSet},` : ""}updated_by=@actor,updated_at=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(id,code,name,description,standard_type,priority,is_scored,is_safety_critical,direction,
          unit_label,measurement_source,resolver_key,source_system,data_source_note,responsible_team,assigned_to,cap_rule_note,sort_order,
          effective_start_date,effective_end_date,${guardedColumns ? `${guardedColumns},` : ""}updated_by)
          VALUES(@id,@code,@name,@description,@type,@priority,@scored,@safety,@direction,@unit,@source,@resolver,@source_system,@data_note,
            @team,@assigned,@cap_note,@sort,@start,@end,${guardedValues ? `${guardedValues},` : ""}@actor);
      `);
      return { status: 200, jsonBody: { id } };
    } catch (error) {
      context.error("PUT /performance-standards/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("performanceStandardTiersPut", {
  route: "performance-standards/{id}/tiers",
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid standard id" } };
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateStandardTierLadder(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    const agreementId = (body.agreement_id ?? null) as string | null;
    const effectiveStart = String(body.effective_start_date);
    const tiers = body.tiers as Record<string, unknown>[];

    const pool = await getPool();
    // A tier row carries its scope in ContractorStandardTiers.agreement_id,
    // which migration 102 adds. Refusing here with the migration named beats
    // failing on an unknown column, and matches what the agreement endpoints
    // already do - editing bands is a new capability, so there is nothing to
    // fall back to.
    if (!(await agreementScope(pool)).scoped) {
      return { status: 409, jsonBody: { error: "Migration 102 has not been applied to this database yet, so tier bands cannot be edited here." } };
    }
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const standardReq = new sql.Request(tx);
      standardReq.input("id", sql.UniqueIdentifier, id);
      const standard = await standardReq.query<{ id: string }>(`SELECT id FROM ContractorPerformanceStandards WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`);
      if (!standard.recordset[0]) { await tx.rollback(); return { status: 404, jsonBody: { error: "Standard not found" } }; }
      if (agreementId) {
        const agreementReq = new sql.Request(tx);
        agreementReq.input("agreement", sql.UniqueIdentifier, agreementId);
        const agreement = await agreementReq.query<{ id: string }>(`SELECT id FROM PerformanceAgreements WHERE id=@agreement`);
        if (!agreement.recordset[0]) { await tx.rollback(); return { status: 404, jsonBody: { error: "Agreement not found" } }; }
      }

      // A ladder is versioned, not overwritten: Attachment G bands change by
      // amendment, and "what was the band in March" has to stay answerable.
      // Saving a ladder replaces the version starting on the same date - an
      // edit to a draft - and otherwise closes the open version the day before
      // the new one begins. Periods already opened are untouched either way;
      // they scored against their own AssessmentPeriodTiers snapshot.
      //
      // The whole thing is one transaction, so a concurrent compute sees either
      // the old ladder entire or the new one, never a half-applied band set.
      const replace = new sql.Request(tx);
      replace.input("id", sql.UniqueIdentifier, id);
      replace.input("agreement", sql.UniqueIdentifier, agreementId);
      replace.input("start", sql.Char(8), effectiveStart);
      await replace.query(`
        DELETE FROM ContractorStandardTiers
        WHERE standard_id=@id AND ((@agreement IS NULL AND agreement_id IS NULL) OR agreement_id=@agreement)
          AND effective_start_date=@start;
        UPDATE ContractorStandardTiers
        SET effective_end_date=CONVERT(char(8),DATEADD(day,-1,CONVERT(date,@start,112)),112)
        WHERE standard_id=@id AND ((@agreement IS NULL AND agreement_id IS NULL) OR agreement_id=@agreement)
          AND effective_start_date<@start
          AND (effective_end_date IS NULL OR effective_end_date>=@start);
      `);

      for (const [index, tier] of tiers.entries()) {
        const insert = new sql.Request(tx);
        insert.input("standard", sql.UniqueIdentifier, id);
        insert.input("agreement", sql.UniqueIdentifier, agreementId);
        insert.input("order", sql.Int, index + 1);
        insert.input("label", sql.NVarChar(20), tier.tier_label);
        insert.input("low", sql.Float, tier.bound_low ?? null);
        insert.input("high", sql.Float, tier.bound_high ?? null);
        insert.input("qualifier", sql.NVarChar(50), tier.qualifier_code ?? null);
        insert.input("basis", sql.NVarChar(30), tier.penalty_basis);
        insert.input("amount", sql.Decimal(12, 2), tier.penalty_amount);
        insert.input("cap", sql.Bit, tier.triggers_cap);
        insert.input("notes", sql.NVarChar(1000), tier.notes ?? null);
        insert.input("start", sql.Char(8), effectiveStart);
        insert.input("actor", sql.NVarChar(200), auth.principal.userDetails ?? "onboard-console");
        await insert.query(`
          INSERT ContractorStandardTiers(standard_id,agreement_id,tier_order,tier_label,bound_low,bound_high,qualifier_code,
            penalty_basis,penalty_amount,triggers_cap,notes,effective_start_date,effective_end_date,updated_by)
          VALUES(@standard,@agreement,@order,@label,@low,@high,@qualifier,@basis,@amount,@cap,@notes,@start,NULL,@actor);
        `);
      }
      await tx.commit();
      return { status: 200, jsonBody: { standard_id: id, agreement_id: agreementId, effective_start_date: effectiveStart, tier_count: tiers.length } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
      context.error("PUT /performance-standards/{id}/tiers failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("performanceStandardDelete", {
  route: "performance-standards/{id}",
  methods: ["DELETE"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, ADMIN_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const id = request.params.id;
    if (!isGuid(id)) return { status: 400, jsonBody: { error: "Invalid standard id" } };

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      const standardReq = new sql.Request(tx);
      standardReq.input("id", sql.UniqueIdentifier, id);
      const standard = await standardReq.query<{ code: string; name: string }>(`SELECT code,name FROM ContractorPerformanceStandards WITH (UPDLOCK,HOLDLOCK) WHERE id=@id`);
      if (!standard.recordset[0]) { await tx.rollback(); return { status: 404, jsonBody: { error: "Standard not found" } }; }

      // Deleting is only ever for a standard nobody has measured against. Once
      // an occurrence, a hand-entered figure or a period snapshot names it,
      // removing the row would orphan a scored month - and a month that was
      // issued to the contractor has to keep resolving what produced its
      // numbers. Retiring with an effective_end_date is the answer there, and
      // the error says so rather than leaving the administrator guessing.
      const usesReq = new sql.Request(tx);
      usesReq.input("id", sql.UniqueIdentifier, id);
      const uses = await usesReq.query<{ occurrences: number; metrics: number; periods: number }>(`
        SELECT
          (SELECT COUNT(*) FROM ComplianceOccurrences WHERE standard_id=@id) occurrences,
          (SELECT COUNT(*) FROM ManualMetricEntries WHERE standard_id=@id) metrics,
          (SELECT COUNT(*) FROM AssessmentPeriodStandards WHERE standard_id=@id) periods
      `);
      const used = uses.recordset[0];
      const blocking = [
        used.occurrences && `${used.occurrences} compliance occurrence${used.occurrences === 1 ? "" : "s"}`,
        used.metrics && `${used.metrics} monthly figure${used.metrics === 1 ? "" : "s"}`,
        used.periods && `${used.periods} assessment period${used.periods === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (blocking.length) {
        await tx.rollback();
        return {
          status: 409,
          jsonBody: {
            error: `${standard.recordset[0].name} has been assessed against and cannot be deleted: it is referenced by ${blocking.join(", ")}. Retire it with an end date instead, which stops it scoring future months while keeping the ones it already scored intact.`,
            references: used,
          },
        };
      }

      // Tiers and agreement assignments describe the standard rather than
      // recording anything scored, so they go with it.
      const purge = new sql.Request(tx);
      purge.input("id", sql.UniqueIdentifier, id);
      await purge.query(`
        IF OBJECT_ID('dbo.AgreementStandards','U') IS NOT NULL DELETE FROM AgreementStandards WHERE standard_id=@id;
        DELETE FROM ContractorStandardTiers WHERE standard_id=@id;
        DELETE FROM ContractorPerformanceStandards WHERE id=@id;
      `);
      await tx.commit();
      return { status: 200, jsonBody: { id, code: standard.recordset[0].code } };
    } catch (error) {
      try { await tx.rollback(); } catch { /* the transaction is already resolved */ }
      context.error("DELETE /performance-standards/{id} failed", error);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
