// The month boundary, decided as a pure function of what the periods already
// are. The timer (functions/assessmentPeriodOpen.ts) opens what is missing,
// computes a prior month nobody has touched, drafts what it just computed,
// and leaves alone anything a person is in the middle of. Nothing here
// issues, shares, or notifies: a manager acts (design §9).
export type PeriodStatus = "open" | "in_review" | "in_validation" | "stale" | "finalized" | "issued" | "reopened";

// Assessment Periods are calendar months in America/Chicago (CONTEXT).
export function serviceMonthInChicago(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")!.value}${parts.find(p => p.type === "month")!.value}`;
}

export function priorServiceMonth(month: string): string {
  const year = Number(month.slice(0, 4)), m = Number(month.slice(4, 6));
  return m === 1 ? `${year - 1}12` : `${year}${String(m - 1).padStart(2, "0")}`;
}

export interface MonthBoundaryPlan { openCurrent: string | null; openPrior: string | null; compute: string | null; draft: boolean }

// Only a period nobody has reviewed is the timer's to compute: open, stale
// (inputs moved since the last compute), or reopened. Anything from
// in_review onward carries a person's decisions and is not recomputed by a
// clock.
const UNTOUCHED: ReadonlySet<PeriodStatus> = new Set(["open", "stale", "reopened"]);

export function monthBoundaryPlan(input: { now: Date; priorStatus: PeriodStatus | null; currentStatus: PeriodStatus | null }): MonthBoundaryPlan {
  const current = serviceMonthInChicago(input.now), prior = priorServiceMonth(current);
  const compute = input.priorStatus === null || UNTOUCHED.has(input.priorStatus) ? prior : null;
  return { openCurrent: input.currentStatus === null ? current : null, openPrior: input.priorStatus === null ? prior : null, compute, draft: compute !== null };
}
