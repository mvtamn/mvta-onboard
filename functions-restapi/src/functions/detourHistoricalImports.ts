import { randomUUID } from "node:crypto";
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { DETOUR_READ_ROLES, DETOUR_WRITE_ROLES, requireRole } from "../lib/auth";
import { isGuid, validateDetourHistoricalImport } from "../lib/validation";

app.http("detourHistoricalImport", {
  route: "detours/historical-imports", methods: ["POST"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_WRITE_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    let body: Record<string, unknown>;
    try { body = (await request.json()) as Record<string, unknown>; } catch { return { status: 400, jsonBody: { error: "Request body must be valid JSON" } }; }
    const errors = validateDetourHistoricalImport(body);
    if (errors.length) return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    const rows = body.rows as Array<Record<string, unknown>>;
    const batch = randomUUID(); const importedBy = auth.principal.userDetails || "system";
    try {
      const pool = await getPool(); const tx = new sql.Transaction(pool); await tx.begin();
      try {
        for (const [index, row] of rows.entries()) {
          if (typeof row.closure !== "string" || !row.closure.trim()) throw new Error(`row ${index + 1} requires closure`);
          const req = new sql.Request(tx);
          req.input("batch", sql.UniqueIdentifier, batch).input("source_file", sql.NVarChar(255), (body.source_file as string).trim()).input("row_number", sql.Int, index + 1).input("reference", sql.NVarChar(100), row.reference ?? null).input("closure", sql.NVarChar(500), row.closure).input("service_date", sql.NVarChar(50), row.service_date ?? null).input("routes", sql.NVarChar(500), row.routes ?? null).input("audience", sql.NVarChar(200), row.communication_audience ?? null).input("channel", sql.NVarChar(200), row.communication_channel ?? null).input("recipients", sql.NVarChar(1000), row.communication_recipients ?? null).input("content", sql.NVarChar(4000), row.communication_content ?? null).input("communicated_at", sql.DateTime2, row.communicated_at ?? null).input("raw", sql.NVarChar(sql.MAX), JSON.stringify(row)).input("imported_by", sql.NVarChar(200), importedBy);
          await req.query("INSERT INTO DetourHistoricalImports (import_batch_id,source_file,source_row_number,historical_reference,closure,service_date,routes,communication_audience,communication_channel,communication_recipients,communication_content,communicated_at,raw_row_json,imported_by) VALUES (@batch,@source_file,@row_number,@reference,@closure,@service_date,@routes,@audience,@channel,@recipients,@content,@communicated_at,@raw,@imported_by)");
        }
        await tx.commit();
      } catch (err) { await tx.rollback(); throw err; }
      return { status: 201, jsonBody: { import_batch_id: batch, imported_rows: rows.length, historical_only: true } };
    } catch (err) { context.error("POST detour historical import failed:", err); return { status: 400, jsonBody: { error: err instanceof Error ? err.message : "Historical import failed" } }; }
  },
});

app.http("detourHistoricalImportList", {
  route: "detours/historical-imports", methods: ["GET"], authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = requireRole(request, DETOUR_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const batch = request.query.get("import_batch_id");
    if (batch && !isGuid(batch)) return { status: 400, jsonBody: { error: "import_batch_id must be a GUID" } };
    try { const req = (await getPool()).request().input("batch", sql.UniqueIdentifier, batch || null); const result = await req.query("SELECT id, import_batch_id, source_file, source_row_number, historical_reference, closure, service_date, routes, communication_audience, communication_channel, communication_recipients, communication_content, communicated_at, imported_by, imported_at FROM DetourHistoricalImports WHERE @batch IS NULL OR import_batch_id=@batch ORDER BY imported_at DESC, source_row_number"); return { status: 200, jsonBody: { historical_rows: result.recordset } }; }
    catch (err) { context.error("GET detour historical imports failed:", err); return { status: 500, jsonBody: { error: "Internal server error" } }; }
  },
});
