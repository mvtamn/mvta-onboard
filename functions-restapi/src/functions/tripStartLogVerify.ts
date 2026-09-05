// POST /trip-start-log/verify - record what a person saw at a trip's start
// (plans/dispatch-log-spec.md §4.2; §7.1 decided 2026-09-05: SST OCS record
// it). Body: { service_date, trip_id, action, note?, initials? } where action
// is observed_on_time | observed_left_late | not_observed | clear.
//
// The role check is the boundary: OCC.TripStartVerify is the contractor
// desk's additive role (plus OCC.Admin for corrections). The current
// observation is upserted so a cell can be corrected; every change is also
// appended to TripStartVerificationEvents. The poller's actual_* columns are
// never touched here, and this endpoint never touches them either way - the
// auto-computed status sits beside the observation, not instead of it.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, TRIP_START_VERIFY_ROLES } from "../lib/auth";
import { initialsFor, validateVerificationInput } from "../lib/tripStartVerification";

interface VerificationRow {
  observation: string;
  verified_by: string;
  verified_initials: string;
  verified_at: Date;
  note: string | null;
}

function shape(row: VerificationRow | undefined) {
  return row
    ? { observation: row.observation, verified_by: row.verified_by, verified_initials: row.verified_initials, verified_at: row.verified_at.toISOString(), note: row.note }
    : null;
}

const NAME_CLAIMS = ["name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", "preferred_username"];

app.http("tripStartLogVerify", {
  route: "trip-start-log/verify",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, TRIP_START_VERIFY_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const body = await request.json().catch(() => null);
    const parsed = validateVerificationInput(body);
    if (!parsed.ok) return { status: 400, jsonBody: { error: parsed.errors.join("; ") } };
    const input = parsed.value;
    const principal = authResult.principal;
    const recordedBy = principal.userDetails?.trim() || principal.userId || "unknown";
    const displayName = NAME_CLAIMS.map((c) => principal.claims[c]?.[0]).find((v) => v && v.trim());
    const initials = initialsFor(displayName, principal.userDetails, input.initials);

    try {
      const pool = await getPool();
      const ready = await pool.request().query<{ ok: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL
                     AND OBJECT_ID('dbo.TripStartVerifications', 'U') IS NOT NULL
                     AND OBJECT_ID('dbo.TripStartVerificationEvents', 'U') IS NOT NULL
          THEN 1 ELSE 0 END AS ok
      `);
      if (ready.recordset[0]?.ok !== 1) {
        return { status: 503, jsonBody: { error: "Verification recording is not connected: apply migrations 094 and 096." } };
      }

      const exists = pool.request();
      exists.input("service_date", sql.Char(8), input.service_date);
      exists.input("trip_id", sql.NVarChar, input.trip_id);
      const found = await exists.query<{ n: number }>(`
        SELECT COUNT(*) AS n FROM TripStartLog WHERE service_date = @service_date AND trip_id = @trip_id
      `);
      if ((found.recordset[0]?.n ?? 0) === 0) {
        return { status: 404, jsonBody: { error: "No Dispatch Log row exists for that trip and service date." } };
      }

      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const before = new sql.Request(tx);
        before.input("service_date", sql.Char(8), input.service_date);
        before.input("trip_id", sql.NVarChar, input.trip_id);
        const prior = await before.query<VerificationRow>(`
          SELECT observation, verified_by, verified_initials, verified_at, note
          FROM TripStartVerifications WITH (UPDLOCK, HOLDLOCK)
          WHERE service_date = @service_date AND trip_id = @trip_id
        `);
        const previous = prior.recordset[0]?.observation ?? null;

        const write = new sql.Request(tx);
        write.input("service_date", sql.Char(8), input.service_date);
        write.input("trip_id", sql.NVarChar, input.trip_id);
        write.input("by", sql.NVarChar, recordedBy);
        write.input("initials", sql.NVarChar, initials);
        write.input("note", sql.NVarChar, input.note);
        let current: VerificationRow | undefined;
        if (input.action === "clear") {
          await write.query(`DELETE FROM TripStartVerifications WHERE service_date = @service_date AND trip_id = @trip_id`);
        } else {
          write.input("observation", sql.NVarChar, input.action);
          const result = await write.query<VerificationRow>(`
            MERGE TripStartVerifications WITH (HOLDLOCK) AS target
            USING (SELECT @service_date AS service_date, @trip_id AS trip_id) AS src
              ON target.service_date = src.service_date AND target.trip_id = src.trip_id
            WHEN MATCHED THEN UPDATE SET
              observation = @observation, verified_by = @by, verified_initials = @initials,
              verified_at = SYSUTCDATETIME(), note = @note
            WHEN NOT MATCHED THEN INSERT (service_date, trip_id, observation, verified_by, verified_initials, verified_at, note)
              VALUES (@service_date, @trip_id, @observation, @by, @initials, SYSUTCDATETIME(), @note)
            OUTPUT INSERTED.observation, INSERTED.verified_by, INSERTED.verified_initials, INSERTED.verified_at, INSERTED.note;
          `);
          current = result.recordset[0];
        }

        const audit = new sql.Request(tx);
        audit.input("service_date", sql.Char(8), input.service_date);
        audit.input("trip_id", sql.NVarChar, input.trip_id);
        audit.input("previous", sql.NVarChar, previous);
        audit.input("observation", sql.NVarChar, input.action === "clear" ? null : input.action);
        audit.input("by", sql.NVarChar, recordedBy);
        audit.input("initials", sql.NVarChar, initials);
        audit.input("note", sql.NVarChar, input.note);
        await audit.query(`
          INSERT INTO TripStartVerificationEvents (service_date, trip_id, previous_observation, observation, recorded_by, recorded_initials, note)
          VALUES (@service_date, @trip_id, @previous, @observation, @by, @initials, @note)
        `);
        await tx.commit();
        context.log(`Trip-start verification: ${input.trip_id} on ${input.service_date} ${previous ?? "blank"} -> ${input.action} by ${recordedBy} (${initials}).`);
        return { status: 200, jsonBody: { verification: shape(current) } };
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    } catch (err) {
      context.error("Failed to record the trip-start verification:", err);
      return { status: 500, jsonBody: { error: "Failed to record the verification." } };
    }
  },
});
