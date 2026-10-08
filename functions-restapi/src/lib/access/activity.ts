// What has actually happened to OnBoard access (ADR-0032).
//
// Until now the console's Activity log read AccessManagementAudit alone. That
// table belongs to the Graph-era flow: since increment 5 it records previews,
// exports and sign-in views, and nothing about the grants people actually make,
// because granting writes AccessRoleGrants instead. The log therefore showed
// "Checked a change" while every real change stayed invisible.
//
// The OnBoard tables are already an append-only record - a revoked grant stays
// as a row, a decided request keeps its decision, a role edit keeps its history
// - so the feed is read from them rather than written a second time. The
// console merges these entries with the older audit so nothing from before the
// cutover is lost.
import { sql } from "../db";

type Executor = sql.ConnectionPool | sql.Transaction;
const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

export interface ActivityEntry {
  id: string;
  /** Who did it, as it was recorded: a name, or an object id when that is all there was. */
  actor_name: string | null;
  action: string;
  /** The person it was done to, as an AccessPeople id the console can name. */
  target_id: string | null;
  target_name: string | null;
  /** The role the act was about, by name. */
  role: string | null;
  reason: string | null;
  outcome: string;
  occurred_at: string;
}

interface ActivityRow {
  id: string;
  actor_name: string | null;
  action: string;
  target_id: string | null;
  target_name: string | null;
  role: string | null;
  reason: string | null;
  outcome: string;
  occurred_at: Date;
}

/**
 * A pending request past its approval window is already expired; listRequests
 * says so without waiting for somebody to try to decide it, and the feed agrees
 * with the page rather than contradicting it.
 */
const REQUEST_OUTCOME = `CASE WHEN q.status = 'pending' AND q.approval_expires_at < SYSUTCDATETIME() THEN 'expired' ELSE q.status END`;

const SELECT_ACTIVITY = `
  SELECT TOP (@limit) id, actor_name, action, target_id, target_name, role, reason, outcome, occurred_at
  FROM (
    SELECT CONCAT(CONVERT(NVARCHAR(64), g.grant_id), ':granted') AS id,
           COALESCE(g.granted_by, g.approved_by) AS actor_name,
           'access_grant' AS action,
           CONVERT(NVARCHAR(64), g.person_id) AS target_id,
           p.display_name AS target_name,
           r.name AS role,
           CONVERT(NVARCHAR(1000), NULL) AS reason,
           'completed' AS outcome,
           g.granted_at AS occurred_at
      FROM AccessRoleGrants g
      JOIN AccessPeople p ON p.person_id = g.person_id
      LEFT JOIN AccessRoles r ON r.role_key = g.role_key

    UNION ALL
    SELECT CONCAT(CONVERT(NVARCHAR(64), g.grant_id), ':revoked'),
           g.revoked_by, 'access_revoke', CONVERT(NVARCHAR(64), g.person_id), p.display_name, r.name,
           CONVERT(NVARCHAR(1000), g.revoke_reason), 'completed', g.revoked_at
      FROM AccessRoleGrants g
      JOIN AccessPeople p ON p.person_id = g.person_id
      LEFT JOIN AccessRoles r ON r.role_key = g.role_key
     WHERE g.revoked_at IS NOT NULL

    UNION ALL
    SELECT CONCAT(CONVERT(NVARCHAR(64), q.request_id), ':requested'),
           q.requested_by_name,
           CASE WHEN q.action = 'revoke' THEN 'privileged_removal_requested' ELSE 'privileged_change_requested' END,
           CONVERT(NVARCHAR(64), q.person_id), p.display_name, r.name,
           CONVERT(NVARCHAR(1000), q.reason), ${REQUEST_OUTCOME}, q.requested_at
      FROM AccessGrantRequests q
      JOIN AccessPeople p ON p.person_id = q.person_id
      LEFT JOIN AccessRoles r ON r.role_key = q.role_key

    UNION ALL
    SELECT CONCAT(CONVERT(NVARCHAR(64), q.request_id), ':decided'),
           q.decided_by_name,
           CASE q.status
             WHEN 'approved' THEN 'privileged_change_approved'
             WHEN 'rejected' THEN 'privileged_change_rejected'
             WHEN 'cancelled' THEN 'privileged_change_cancelled'
             ELSE 'privileged_change_expired' END,
           CONVERT(NVARCHAR(64), q.person_id), p.display_name, r.name,
           CONVERT(NVARCHAR(1000), q.decision_reason), q.status, q.decided_at
      FROM AccessGrantRequests q
      JOIN AccessPeople p ON p.person_id = q.person_id
      LEFT JOIN AccessRoles r ON r.role_key = q.role_key
     WHERE q.decided_at IS NOT NULL

    UNION ALL
    SELECT CONVERT(NVARCHAR(64), h.history_id),
           h.actor_name,
           CASE h.change WHEN 'created' THEN 'role_created' WHEN 'archived' THEN 'role_archived' ELSE 'role_edited' END,
           NULL, NULL, COALESCE(r.name, h.role_key),
           CONVERT(NVARCHAR(1000), h.note), 'completed', h.occurred_at
      FROM AccessRoleHistory h
      LEFT JOIN AccessRoles r ON r.role_key = h.role_key
  ) activity
  ORDER BY occurred_at DESC`;

/**
 * The most recent administrative acts on OnBoard access, newest first. Capped
 * because the console shows one page of it; the tables stay the record.
 */
export async function listActivity(executor: Executor, limit = 300): Promise<ActivityEntry[]> {
  const result = await request(executor)
    .input("limit", sql.Int, limit)
    .query<ActivityRow>(SELECT_ACTIVITY);
  return result.recordset.map((row) => ({
    id: row.id,
    actor_name: row.actor_name,
    action: row.action,
    target_id: row.target_id,
    target_name: row.target_name,
    role: row.role,
    reason: row.reason,
    outcome: row.outcome,
    occurred_at: row.occurred_at.toISOString(),
  }));
}

/** Set once migration 130's history table is present as well as 129 and 131. */
export async function activityAvailable(executor: Executor): Promise<boolean> {
  const row = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.AccessRoleHistory','U') IS NULL THEN 0 ELSE 1 END AS ready
  `);
  return row.recordset[0]?.ready === 1;
}
