import { randomUUID } from "node:crypto";
import { sql } from "./db";

/**
 * Append one Procedure Audit Event.
 *
 * Takes anything that issues requests - a pool or an open transaction - so an
 * event commits with whatever change it describes, never on its own.
 */
export async function recordProcedureAuditEvent(
  executor: { request: () => sql.Request },
  procedureId: string,
  revision: number,
  eventType: string,
  actor: string,
  reason: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  const request = executor.request();
  request.input("id", sql.UniqueIdentifier, randomUUID());
  request.input("procedure_id", sql.NVarChar, procedureId);
  request.input("revision", sql.Int, revision);
  request.input("event_type", sql.NVarChar, eventType);
  request.input("actor", sql.NVarChar, actor);
  request.input("reason", sql.NVarChar, reason);
  request.input("details", sql.NVarChar, JSON.stringify(details));
  await request.query("INSERT INTO ProcedureAuditEvents(event_id,procedure_id,revision,event_type,actor,reason,details_json) VALUES(@id,@procedure_id,@revision,@event_type,@actor,@reason,@details)");
}
