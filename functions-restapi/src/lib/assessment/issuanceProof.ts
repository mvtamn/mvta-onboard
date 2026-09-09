import { sql } from "../db";

// An Issuance Proof is voided, never deleted, when it stops being the render
// the Issuing Authority should check: another proof is prepared, the period
// is reopened, or evidence lands on a finalized month (ADR 0029). The three
// handlers that cause that share this fragment so the rule cannot drift.
// `periodParam` and `actorParam` name parameters the caller has already bound.
// The table variable is named after the period parameter so a batch that
// voids under two different period bindings does not redeclare it; the same
// binding twice in one batch would, and no caller needs that.
export function voidLiveIssuanceProofSql(periodParam: string, actorParam: string): string {
  const voided = `@voided_proofs_${periodParam}`;
  return `
        DECLARE ${voided} TABLE(id UNIQUEIDENTIFIER);
        UPDATE ComplianceReports SET voided_at=SYSUTCDATETIME(),voided_by=@${actorParam}
        OUTPUT inserted.id INTO ${voided}(id)
        WHERE period_id=@${periodParam} AND issuance_type='final' AND issued_at IS NULL AND voided_at IS NULL;
        INSERT ComplianceAssessmentAudit(entity_type,entity_id,action,actor) SELECT 'report',id,'issuance_proof_voided',@${actorParam} FROM ${voided};`;
}

// Generate and issue each allocate a version, write a blob, and write SQL -
// three steps nothing ordered, so two clicks could both take version 2 and
// collide on UQ_CR_Version after both blobs were written. One exclusive
// application lock per period, held for the transaction, serialises them: the
// second click waits, then sees the first's row. It does not make the blob and
// the row one write - a process that dies between upload and INSERT still
// leaves a blob nothing points at, which is harmless and unserved. The lock is
// held across that upload, which no other transaction in this codebase does;
// the write set under it is one row, and readers are not blocked under RCSI.
export async function withPeriodReportLock<T>(pool: sql.ConnectionPool, periodId: string, work: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lock = new sql.Request(tx);
    lock.input("resource", sql.NVarChar(255), `assessment-report:${periodId}`);
    const held = await lock.query<{ result: number }>(`DECLARE @result INT;EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;SELECT @result result`);
    if ((held.recordset[0]?.result ?? -1) < 0) throw new Error("Another report operation on this Assessment Period is still running");
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}
