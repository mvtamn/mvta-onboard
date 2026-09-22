// Reading the one admin-configurable OTP Compliance setting.
//
// The value lived only inside the GET /otp-settings handler until the flagging
// rule moved to the server (ADR 0034) and needed it too. The query is a plain
// SELECT and stays untested; the part that has ever actually been wrong - what
// answers when migration-018 has not run, or has run but seeded no row - is
// split out as `thresholdOrDefault` and tested.
import { sql } from "./db";
import { DEFAULT_EARLY_LATE_BIAS_THRESHOLD } from "./otpFlaggedStops";
import type { Executor } from "./otpMonth";

export interface OtpSettingsRow {
  early_late_bias_threshold: number;
  updated_by: string | null;
  updated_at: Date | null;
}

/**
 * The threshold a row yields, or the code default when there is no row, no
 * table, or a stored value outside the 0-1 range validation would have
 * refused. Never returns null: a missing setting must not stop a reviewer
 * seeing a queue.
 */
export function thresholdOrDefault(row: Pick<OtpSettingsRow, "early_late_bias_threshold"> | undefined | null): number {
  const stored = row?.early_late_bias_threshold;
  if (typeof stored !== "number" || !Number.isFinite(stored)) return DEFAULT_EARLY_LATE_BIAS_THRESHOLD;
  if (stored <= 0 || stored >= 1) return DEFAULT_EARLY_LATE_BIAS_THRESHOLD;
  return stored;
}

/** The Early/Late Bias Threshold in force, falling back to the code default. */
export async function readEarlyLateBiasThreshold(executor: Executor): Promise<number> {
  const probe = executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();
  const tableCheck = await probe.query<{ table_exists: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpSettings', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
  `);
  if (tableCheck.recordset[0]?.table_exists !== 1) return DEFAULT_EARLY_LATE_BIAS_THRESHOLD;

  const read = executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();
  const result = await read.query<OtpSettingsRow>(`
    SELECT early_late_bias_threshold, updated_by, updated_at FROM OtpSettings WHERE id = 1
  `);
  return thresholdOrDefault(result.recordset[0]);
}
