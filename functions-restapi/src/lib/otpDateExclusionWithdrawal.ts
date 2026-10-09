import { sql } from "./db";

// Withdrawing an approved weather date: the two decisions worth stating once.
//
// Since migration 140 an approved date subtracts departures from the official
// monthly figure, so undoing one moves a published number. That is allowed -
// an approval made in error has to be correctable - but not silently.

/** The longest withdrawal reason the column holds (migration 142). */
export const WITHDRAWAL_REASON_MAX = 500;

export type WithdrawalReason =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * A reason is required, and it is required to say something. An approved
 * figure that moves with a blank justification is exactly what a reviewer
 * would later be unable to explain to the agency.
 */
export function withdrawalReason(raw: unknown): WithdrawalReason {
  if (typeof raw !== "string") return { ok: false, error: "Withdrawing an approved date needs a reason" };
  const reason = raw.trim();
  if (!reason) return { ok: false, error: "Withdrawing an approved date needs a reason" };
  if (reason.length > WITHDRAWAL_REASON_MAX) {
    return { ok: false, error: `A withdrawal reason must be ${WITHDRAWAL_REASON_MAX} characters or fewer` };
  }
  return { ok: true, reason };
}

/**
 * Whether migration 142 is applied. Without its columns a withdrawal would
 * flip the status and lose the account of who did it and why - which is the
 * only part of a withdrawal that is not already recoverable from the row.
 * Answering 503 says which migration to run, rather than failing as an outage.
 */
export async function withdrawalRecordable(pool: sql.ConnectionPool): Promise<boolean> {
  const ready = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.OtpDateExclusions', 'withdrawn_by') IS NULL
                  OR COL_LENGTH('dbo.OtpDateExclusions', 'withdrawn_at') IS NULL
                  OR COL_LENGTH('dbo.OtpDateExclusions', 'withdrawal_reason') IS NULL
                THEN 0 ELSE 1 END AS ready
  `);
  return ready.recordset[0]?.ready === 1;
}
