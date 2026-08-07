// POST /detours - create a detour/closure record (manual entry).
// `source` is never accepted from the request body - every detour created
// through this endpoint is `source='manual'`; only the future Avail sync
// (Part B4) ever writes `source='avail'` rows. Publisher/Admin (same tier as
// posting a rider message) plus the dedicated OCC.Detour role - see
// DETOUR_WRITE_ROLES in auth.ts. OCC.Detour can create and edit but NOT
// delete; deletion stays at the publisher tier.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, DETOUR_WRITE_ROLES } from "../lib/auth";
import { validateCreateDetour } from "../lib/validation";
import { formatDetourNumber, detourNumberYear } from "../lib/detourNumbering";
import type { CreateDetourBody } from "../lib/types";

interface InsertedDetour {
  id: string;
  created_at: Date;
}

interface AllocatedSequence {
  assigned: number;
}

// Allocates this year's next internal detour number (Part B10). One atomic
// MERGE, so bootstrapping a brand-new year and incrementing an existing one
// are the same statement - there is no read-then-write gap for two concurrent
// creates to slip through, which a SELECT-then-INSERT bootstrap would have on
// Jan 1. HOLDLOCK is what makes the not-matched branch safe under contention.
// On the insert branch DELETED.next_value is NULL, hence the COALESCE to 1.
async function allocateDetourNumber(tx: sql.Transaction, year: number): Promise<string> {
  const req = new sql.Request(tx);
  req.input("year", sql.Int, year);
  const result = await req.query<AllocatedSequence>(`
    MERGE DetourNumberSequences WITH (HOLDLOCK) AS target
    USING (SELECT @year AS year) AS source
      ON target.year = source.year
    WHEN MATCHED THEN
      UPDATE SET next_value = target.next_value + 1
    WHEN NOT MATCHED THEN
      INSERT (year, next_value) VALUES (source.year, 2)
    OUTPUT COALESCE(DELETED.next_value, 1) AS assigned;
  `);
  const assigned = result.recordset[0]?.assigned;
  if (assigned === undefined) {
    throw new Error(`Failed to allocate an internal detour number for ${year}`);
  }
  return formatDetourNumber(year, assigned);
}

app.http("detoursCreate", {
  route: "detours",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_WRITE_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const errors = validateCreateDetour(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as CreateDetourBody;
    const createdBy = authResult.principal.userDetails || "system";

    const pool = await getPool();

    // Numbering (Part B10) is skipped entirely until migration-024 has run,
    // rather than failing the whole create - same table-exists guard pattern
    // used by detourImagesPurge.ts and availAvlPoll.ts for un-run migrations.
    // Both objects are checked because the migration adds both.
    const schemaCheck = await pool.request().query<{ numbering_ready: number }>(`
      SELECT CASE
        WHEN OBJECT_ID('dbo.DetourNumberSequences', 'U') IS NOT NULL
         AND COL_LENGTH('dbo.Detours', 'internal_number') IS NOT NULL
        THEN 1 ELSE 0 END AS numbering_ready
    `);
    const numberingReady = schemaCheck.recordset[0]?.numbering_ready === 1;
    if (!numberingReady) {
      context.warn(
        "DetourNumberSequences/Detours.internal_number not present (migration-024 not run) - creating this detour without an internal number.",
      );
    }

    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const internalNumber = numberingReady
        ? await allocateDetourNumber(tx, detourNumberYear(body.start_date, new Date()))
        : null;

      const insertReq = new sql.Request(tx);
      insertReq.input("number", sql.NVarChar, body.number ?? null);
      insertReq.input("closure", sql.NVarChar, body.closure);
      insertReq.input("start_date", sql.Date, body.start_date ?? null);
      insertReq.input("end_date", sql.Date, body.end_date ?? null);
      insertReq.input("is_monitor_only", sql.Bit, body.is_monitor_only ?? false);
      insertReq.input("riders_directed", sql.NVarChar, body.riders_directed ?? null);
      insertReq.input("email_sent", sql.Bit, body.email_sent ?? false);
      insertReq.input("expired_email_sent", sql.Bit, body.expired_email_sent ?? false);
      insertReq.input("spare_emailed", sql.Bit, body.spare_emailed ?? false);
      insertReq.input("created_by", sql.NVarChar, createdBy);
      if (internalNumber !== null) {
        insertReq.input("internal_number", sql.NVarChar, internalNumber);
      }
      const result = await insertReq.query<InsertedDetour>(`
        INSERT INTO Detours (
          number, closure, start_date, end_date, is_monitor_only, riders_directed,
          email_sent, expired_email_sent, spare_emailed, source, created_by
          ${internalNumber !== null ? ", internal_number" : ""}
        )
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (
          @number, @closure, @start_date, @end_date, @is_monitor_only, @riders_directed,
          @email_sent, @expired_email_sent, @spare_emailed, 'manual', @created_by
          ${internalNumber !== null ? ", @internal_number" : ""}
        )
      `);
      const inserted = result.recordset[0];

      for (const [i, seg] of (body.segments ?? []).entries()) {
        const segReq = new sql.Request(tx);
        segReq.input("detour_id", sql.UniqueIdentifier, inserted.id);
        segReq.input("routes", sql.NVarChar, seg.routes);
        segReq.input("directions", sql.NVarChar, seg.directions ?? null);
        segReq.input("sort_order", sql.Int, seg.sort_order ?? i);
        await segReq.query(`
          INSERT INTO DetourSegments (detour_id, routes, directions, sort_order)
          VALUES (@detour_id, @routes, @directions, @sort_order)
        `);
      }

      await tx.commit();
      return {
        status: 201,
        jsonBody: {
          id: inserted.id,
          created_at: inserted.created_at,
          internal_number: internalNumber,
        },
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("POST /detours failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
