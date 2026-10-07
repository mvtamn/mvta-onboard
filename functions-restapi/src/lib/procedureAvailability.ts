import { sql } from "./db";

// Why a bookmarked Procedure needs its own answer.
//
// The reader lists Approved revisions only, which is correct: withdrawn
// guidance must not be read as current. But a controller's bookmark carries
// ?procedure_id=, and when that Procedure is no longer approved the reader
// found nothing, selected nothing, and said nothing - a collapsed list of
// OTHER Procedures with no hint that the one they asked for is gone. The
// dangerous reading is not "this is missing"; it is "this must be fine, the
// Matrix just opened on the list".
//
// Two cases must not be confused, and only the database can tell them apart:
//   - the search box filtered it out        -> still approved, nothing is wrong
//   - the revision was retired or withdrawn -> must not be used
// So this module answers for ONE procedure id, independent of any search.
//
// Retirement and emergency withdrawal both leave lifecycle_state 'Retired'.
// The difference lives in the audit event, and it matters to the controller:
// ordinary retirement is REQUIRED to name an approved replacement, so there is
// somewhere to send them; emergency withdrawal records only a reason, because
// the point of it is to stop guidance fast, not to have an answer ready.

/** The replacement an ordinary retirement named, once confirmed still approved. */
export interface ProcedureReplacement {
  procedure_id: string;
  revision: number;
  condition: string;
}

export type ProcedureAvailability =
  /** Approved right now. The reader simply did not have it in view. */
  | { state: "approved" }
  /** Stopped deliberately and urgently. Usually no replacement exists. */
  | { state: "withdrawn"; condition: string; decided_at: string; reason: string | null; replacement: ProcedureReplacement | null }
  /** Replaced in the ordinary way. A replacement was required to retire it. */
  | { state: "retired"; condition: string; decided_at: string; reason: string | null; replacement: ProcedureReplacement | null }
  /** Authored but never approved, so it has never been readable guidance. */
  | { state: "unpublished"; condition: string }
  /** No Procedure carries this id - a mistyped or very old link. */
  | { state: "unknown" };

type TerminalEvent = { event_type: string; reason: string | null; occurred_at: Date };

/**
 * The replacement an audit event named, or null. `retire` writes both fields;
 * `superseded` writes only a revision, which is always the same procedure.
 * Anything else - a withdrawal's `{}`, malformed JSON, a non-integer revision -
 * is no replacement rather than a broken answer, because this runs while
 * someone is trying to find out what to do instead.
 */
export function replacementFrom(detailsJson: string, procedureId: string): { procedure_id: string; revision: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(detailsJson); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const details = parsed as { replacement_procedure_id?: unknown; replacement_revision?: unknown };
  // Number() turns null, "", [] and false into 0, and Number.isInteger(0) is
  // true - which quietly produced a replacement pointing at "revision 0", a
  // link that dead-ends exactly like the one it was meant to rescue. The raw
  // value has to be a number, and revisions start at 1.
  const raw = details.replacement_revision;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) return null;
  const revision = raw;
  const id = typeof details.replacement_procedure_id === "string" && details.replacement_procedure_id.trim()
    ? details.replacement_procedure_id.trim()
    : procedureId;
  return { procedure_id: id, revision };
}

/**
 * Decides availability from what was read. Pure, so every branch is checkable
 * without a database: the four states, and a named replacement that has since
 * stopped being approved (reported as no replacement rather than as a link
 * that would dead-end again).
 */
export function availabilityFrom(input: {
  condition: string | null;
  hasApproved: boolean;
  terminal: TerminalEvent | null;
  replacement: ProcedureReplacement | null;
}): ProcedureAvailability {
  if (input.condition === null) return { state: "unknown" };
  if (input.hasApproved) return { state: "approved" };
  if (!input.terminal) return { state: "unpublished", condition: input.condition };
  const withdrawn = input.terminal.event_type === "emergency_withdrawal";
  return {
    state: withdrawn ? "withdrawn" : "retired",
    condition: input.condition,
    decided_at: input.terminal.occurred_at.toISOString(),
    reason: input.terminal.reason,
    replacement: input.replacement,
  };
}

/**
 * Reads the one Procedure, whether any revision of it is approved, and the
 * most recent event that ended it. `superseded` is deliberately NOT a terminal
 * event here: a superseded revision means a newer one was approved, which the
 * reader would have found, so seeing it without an approved revision means the
 * newer one was itself retired - and that retirement is the later event.
 */
export async function readProcedureAvailability(pool: sql.ConnectionPool, procedureId: string): Promise<ProcedureAvailability> {
  const found = await pool.request().input("procedure_id", sql.NVarChar, procedureId).query<{ condition: string; approved_count: number }>(`
    SELECT p.condition,
           (SELECT COUNT(*) FROM ProcedureRevisions r WHERE r.procedure_id=p.procedure_id AND r.lifecycle_state='Approved') AS approved_count
    FROM Procedures p WHERE p.procedure_id=@procedure_id`);
  const procedure = found.recordset[0];
  if (!procedure) return availabilityFrom({ condition: null, hasApproved: false, terminal: null, replacement: null });
  if (procedure.approved_count > 0) return availabilityFrom({ condition: procedure.condition, hasApproved: true, terminal: null, replacement: null });

  const ended = await pool.request().input("procedure_id", sql.NVarChar, procedureId).query<TerminalEvent & { details_json: string }>(`
    SELECT TOP 1 event_type, reason, occurred_at, details_json
    FROM ProcedureAuditEvents
    WHERE procedure_id=@procedure_id AND event_type IN ('retire','emergency_withdrawal')
    ORDER BY occurred_at DESC`);
  const terminal = ended.recordset[0] ?? null;
  if (!terminal) return availabilityFrom({ condition: procedure.condition, hasApproved: false, terminal: null, replacement: null });

  const named = replacementFrom(terminal.details_json, procedureId);
  let replacement: ProcedureReplacement | null = null;
  if (named) {
    // Approval of the replacement was checked when the retirement happened.
    // It can have been retired since, so it is re-checked rather than trusted.
    const still = await pool.request()
      .input("procedure_id", sql.NVarChar, named.procedure_id)
      .input("revision", sql.Int, named.revision)
      .query<{ condition: string }>(`
        SELECT p.condition FROM ProcedureRevisions r
        JOIN Procedures p ON p.procedure_id=r.procedure_id
        WHERE r.procedure_id=@procedure_id AND r.revision=@revision AND r.lifecycle_state='Approved'`);
    const row = still.recordset[0];
    if (row) replacement = { procedure_id: named.procedure_id, revision: named.revision, condition: row.condition };
  }
  return availabilityFrom({ condition: procedure.condition, hasApproved: false, terminal, replacement });
}
