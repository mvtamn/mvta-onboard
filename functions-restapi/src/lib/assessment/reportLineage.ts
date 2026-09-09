// Which Final Assessment a new one supersedes is a fact about the Assessment
// Period, not a choice the client makes. A period created by reopening an
// issued month carries supersedes_period_id; a Final generated from it corrects
// the latest Final that period issued, and needs a recorded reason. A period
// that corrects nothing cannot supersede anything, and a reason offered for it
// would print on the cover as a correction that never happened (ADR 0029).

export interface PeriodLineage {
  supersedesPeriodId: string | null;
  // The latest issued Final of the period being corrected, or null when that
  // period never issued one. Null with a supersedesPeriodId is a broken chain.
  latestIssuedFinalOfSupersededPeriod: string | null;
}

export interface FinalRequestBody {
  supersede_reason?: unknown;
  // Accepted from older clients and ignored: the server knows the target.
  supersedes_id?: unknown;
}

export type FinalRequest =
  | { ok: true; supersedesId: string | null; supersedeReason: string | null }
  | { ok: false; error: string };

export function resolveFinalRequest(lineage: PeriodLineage, body: FinalRequestBody): FinalRequest {
  const reason = typeof body.supersede_reason === "string" ? body.supersede_reason.trim() : "";
  if (lineage.supersedesPeriodId === null) {
    if (reason) return { ok: false, error: "This Assessment Period corrects nothing, so it cannot carry a supersede reason" };
    return { ok: true, supersedesId: null, supersedeReason: null };
  }
  if (!lineage.latestIssuedFinalOfSupersededPeriod) {
    return { ok: false, error: "The corrected Assessment Period never issued a Final Assessment; there is nothing to supersede" };
  }
  if (!reason) return { ok: false, error: "A Superseding Final Assessment requires a reason" };
  return { ok: true, supersedesId: lineage.latestIssuedFinalOfSupersededPeriod, supersedeReason: reason };
}
