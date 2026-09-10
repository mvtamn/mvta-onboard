import type { Transaction } from "mssql";
import { sql } from "../db";

// Saving a hand-entered monthly figure.
//
// ManualMetricEntries keeps every figure ever entered: the live one has
// superseded_by NULL and each earlier one points at the row that replaced it.
// Two constraints from migration 030 guard that shape and pull in opposite
// directions when a figure is changed. UX_MME_Current allows one live row per
// standard, contractor and month, so the old row must be superseded before the
// new one is live; and superseded_by is a foreign key to id, so the old row
// cannot point at the new one until the new one exists. The handler used to
// insert first and supersede second, which the index refused - every second
// entry for a month, the "Change" button, answered 500, and the first entry
// only worked because there was nothing to supersede.
//
// The new row is inserted superseded by itself, which the filtered index does
// not count; the old row is pointed at it; then it is made live. All inside
// the caller's transaction, so nothing outside ever sees the intermediate
// rows.

export interface ManualMetricWrite {
  standardId: string;
  contractorId: string;
  serviceMonth: string;
  metricValue: number;
  numerator?: number | null;
  denominator?: number | null;
  unitCount?: number | null;
  sourceNote: string;
  enteredBy: string;
}

export interface ManualMetricWritten {
  id: string;
  /** The row this one replaced, or null for the month's first entry. */
  supersededId: string | null;
}

export async function writeManualMetric(tx: Transaction, input: ManualMetricWrite): Promise<ManualMetricWritten> {
  const find = new sql.Request(tx);
  find.input("standard", sql.UniqueIdentifier, input.standardId);
  find.input("contractor", sql.UniqueIdentifier, input.contractorId);
  find.input("month", sql.Char(6), input.serviceMonth);
  const current = await find.query<{ id: string }>(
    `SELECT id FROM ManualMetricEntries WITH(UPDLOCK,HOLDLOCK) WHERE standard_id=@standard AND contractor_id=@contractor AND service_month=@month AND superseded_by IS NULL`,
  );
  const supersededId = current.recordset[0]?.id ?? null;
  const id = crypto.randomUUID();

  const write = new sql.Request(tx);
  write.input("id", sql.UniqueIdentifier, id);
  write.input("standard", sql.UniqueIdentifier, input.standardId);
  write.input("contractor", sql.UniqueIdentifier, input.contractorId);
  write.input("month", sql.Char(6), input.serviceMonth);
  write.input("value", sql.Float, input.metricValue);
  write.input("numerator", sql.Float, input.numerator ?? null);
  write.input("denominator", sql.Float, input.denominator ?? null);
  write.input("units", sql.Int, input.unitCount ?? null);
  write.input("note", sql.NVarChar(1000), input.sourceNote);
  write.input("actor", sql.NVarChar(200), input.enteredBy);
  write.input("self", sql.UniqueIdentifier, supersededId ? id : null);
  await write.query(
    `INSERT ManualMetricEntries(id,standard_id,contractor_id,service_month,metric_value,numerator,denominator,unit_count,source_note,entered_by,superseded_by) VALUES(@id,@standard,@contractor,@month,@value,@numerator,@denominator,@units,@note,@actor,@self)`,
  );

  if (supersededId) {
    const supersede = new sql.Request(tx);
    supersede.input("old", sql.UniqueIdentifier, supersededId);
    supersede.input("new", sql.UniqueIdentifier, id);
    await supersede.query(`UPDATE ManualMetricEntries SET superseded_by=@new WHERE id=@old; UPDATE ManualMetricEntries SET superseded_by=NULL WHERE id=@new;`);
  }

  // A changed input marks the month stale until it is recomputed; a month
  // already finalized keeps the figures it was scored with.
  const stale = new sql.Request(tx);
  stale.input("contractor", sql.UniqueIdentifier, input.contractorId);
  stale.input("month", sql.Char(6), input.serviceMonth);
  await stale.query(
    `UPDATE AssessmentPeriods SET input_revision=input_revision+1,status=CASE WHEN status IN('in_review','stale') THEN 'stale' ELSE status END WHERE contractor_id=@contractor AND service_month=@month AND status<>'finalized'`,
  );
  return { id, supersededId };
}
