import type { AssessmentPeriod, AssessmentPeriodStatus, ComplianceOccurrence, PeriodKpiAssessment } from "@mvta/shared";

// The month-at-a-glance card, as decisions rather than markup.
//
// The card answers three questions for one contractor and one service month:
// where the month is in its lifecycle, what it adds up to, and what is still
// in somebody's way. Each of those is a pure reading of the period, its
// scored rows and its occurrences, kept here so it can be tested without a
// DOM and so the component stays a renderer.

/** The stages a month passes through, in order, in the words the card uses. */
export const LIFECYCLE = ["Opened", "Computed", "In review", "Validation", "Finalized", "Issued"] as const;

export type LifecycleStage = { label: (typeof LIFECYCLE)[number]; state: "done" | "current" | "upcoming" };

/**
 * Which stage each status sits at. `stale` is a computed month whose inputs
 * moved, so it stands at Computed with a flag rather than falling back to
 * Opened; `reopened` really is back at the start.
 */
export function lifecycleStages(status: AssessmentPeriodStatus | null): LifecycleStage[] {
  const current: Record<AssessmentPeriodStatus, number> = {
    open: 0, reopened: 0, stale: 1, in_review: 2, in_validation: 3, finalized: 4, issued: 5,
  };
  const at = status === null ? -1 : current[status];
  return LIFECYCLE.map((label, index) => ({
    label,
    // An issued month is finished: every stage, the last included, is done.
    state: index < at || (status === "issued" && index === at) ? "done" : index === at ? "current" : "upcoming",
  }));
}

/** The status pill: the console's semantic pill classes, and a short label. */
export function statusPill(status: AssessmentPeriodStatus | null): { className: string; label: string } {
  switch (status) {
    case null: return { className: "pill-muted", label: "Not opened" };
    case "open": return { className: "pill-muted", label: "Open" };
    case "reopened": return { className: "pill-warning", label: "Reopened" };
    case "stale": return { className: "pill-danger", label: "Stale · inputs changed" };
    case "in_review": return { className: "pill-warning", label: "In review" };
    case "in_validation": return { className: "pill-accent", label: "In validation" };
    case "finalized": return { className: "pill-success", label: "Finalized" };
    case "issued": return { className: "pill-success", label: "Issued" };
  }
}

export type NextAction =
  | { kind: "open"; label: string }
  | { kind: "compute"; label: string }
  | { kind: "finalize"; label: string }
  | { kind: "go"; label: string; page: "review" | "issuance" };

/**
 * The one button on the card. It names the next thing the month needs, and
 * it is the same thing the section pages already allow at that status - the
 * card is a shortcut, never a second way to move a month.
 */
export function nextAction(status: AssessmentPeriodStatus | null, pending: number): NextAction {
  switch (status) {
    case null: return { kind: "open", label: "Open assessment month" };
    case "open":
    case "reopened": return { kind: "compute", label: "Compute" };
    case "stale": return { kind: "compute", label: "Recompute" };
    case "in_review": return pending > 0 ? { kind: "go", label: "Continue review", page: "review" } : { kind: "go", label: "Prepare Validation Draft", page: "issuance" };
    case "in_validation": return pending > 0 ? { kind: "go", label: "Continue review", page: "review" } : { kind: "finalize", label: "Finalize" };
    case "finalized": return { kind: "go", label: "Issue Final Assessment", page: "issuance" };
    case "issued": return { kind: "go", label: "Disputes", page: "issuance" };
  }
}

export type Outstanding = { key: string; label: string; page: "review" | "metrics" | "occurrences" | "caps"; quiet?: boolean };

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What still stands between this month and finalization, each line pointing
 * at the section where it is done. CAPs are listed last and quietly: they are
 * an outcome to act on, not a blocker on the money.
 */
export function outstandingItems(rows: PeriodKpiAssessment[], occurrences: ComplianceOccurrence[]): Outstanding[] {
  const items: Outstanding[] = [];
  const awaiting = rows.filter((row) => !row.recommended_action && row.assessment_outcome !== "not_assessable");
  if (awaiting.length) {
    const sum = awaiting.reduce((total, row) => total + Number(row.proposed_amount || 0), 0);
    items.push({ key: "review", page: "review", label: `${plural(awaiting.length, "item", "items")} awaiting review · ${money(sum)}` });
  }
  const missing = rows.filter((row) => row.assessment_outcome === "not_assessable").length;
  if (missing) items.push({ key: "metrics", page: "metrics", label: `${plural(missing, "monthly figure", "monthly figures")} missing` });
  const ranged = occurrences.filter((o) =>
    o.review_status === "confirmed" && o.penalty_amount_min != null && o.penalty_amount_max != null && o.assessed_amount == null).length;
  if (ranged) items.push({ key: "amount", page: "occurrences", label: `${plural(ranged, "occurrence needs", "occurrences need")} an amount` });
  const caps = rows.filter((row) => row.cap_required || row.tier_label === "tier2").length;
  if (caps) items.push({ key: "caps", page: "caps", label: `${plural(caps, "CAP", "CAPs")} flagged`, quiet: true });
  return items;
}

/** YYYYMM plus or minus whole months. */
export function stepMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4)), index = Number(month.slice(4, 6)) - 1 + delta;
  const date = new Date(Date.UTC(year, index, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** This month as YYYYMM. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The period for a contractor and month. A correction period carries
 * `supersedes_period_id`, so when two exist for one month the one nothing
 * supersedes is the live one.
 */
export function periodFor(periods: AssessmentPeriod[], contractorId: string, month: string): AssessmentPeriod | undefined {
  const matches = periods.filter((p) => p.contractor_id === contractorId && p.service_month === month);
  return matches.find((p) => !matches.some((other) => other.supersedes_period_id === p.id)) ?? matches[0];
}
