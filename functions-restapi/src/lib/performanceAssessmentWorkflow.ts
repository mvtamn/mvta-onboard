export interface Agreement {
  id: string;
  contractorName: string;
  startsOn: string;
  endsOn: string;
}

export interface AssessmentStandard {
  id: string;
  name: string;
  minimum?: number;
  maximum?: number;
  tiers: Array<{ below?: number; above?: number; amount: number }>;
}

interface Measurement {
  standardId: string;
  value: number;
  sourceRef: string;
}

interface AssessmentPeriod {
  id: string;
  agreementId: string;
  month: string;
  measurements: Measurement[];
  candidates: Array<{ id: string; standardId: string; sourceRef: string; resolution: "unresolved" | "confirmed" | "dismissed" | "deferred" }>;
  items?: Array<{ standardId: string; outcome: string; proposedPenalty: number; sourceRefs: string[] }>;
  reviews: Array<{ standardId: string; reviewer: string; action: "confirm" | "adjust" | "waive" }>;
  validationEndsOn?: string;
  state: "open" | "under_review" | "in_validation" | "finalized" | "issued";
  audit: Array<{ action: string; actor: string }>;
}

function monthLabel(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" }).format(new Date(Date.UTC(year, value - 1, 1, 12)));
}

export function createPerformanceAssessmentWorkflow(input: {
  agreement: Agreement;
  ruleSet: { id: string; standards: AssessmentStandard[] };
  holidays?: string[];
}) {
  const periods = new Map<string, AssessmentPeriod>();

  return {
    open(month: string) {
      const id = `${input.agreement.id}:${month}`;
      const period: AssessmentPeriod = { id, agreementId: input.agreement.id, month, measurements: [], candidates: [], reviews: [], state: "open", audit: [{ action: "opened", actor: "system" }] };
      periods.set(id, period);
      return period;
    },
    recordMeasurement(periodId: string, measurement: Measurement) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      period.measurements.push(measurement);
    },
    recordCandidate(periodId: string, candidate: { standardId: string; sourceRef: string }) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      const recorded = { id: `${periodId}:candidate:${period.candidates.length + 1}`, ...candidate, resolution: "unresolved" as const };
      period.candidates.push(recorded);
      return recorded;
    },
    resolveCandidate(periodId: string, candidateId: string, resolution: "confirmed" | "dismissed" | "deferred") {
      const candidate = periods.get(periodId)?.candidates.find(item => item.id === candidateId);
      if (!candidate) throw new Error("Candidate not found");
      candidate.resolution = resolution;
    },
    compute(periodId: string) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      if (period.candidates.some(candidate => candidate.resolution === "unresolved")) throw new Error("Assessment Period has an unresolved candidate");
      const items = input.ruleSet.standards.map(standard => {
        const measurement = period.measurements.find(candidate => candidate.standardId === standard.id);
        if (!measurement) return { standardId: standard.id, outcome: "not_assessable", proposedPenalty: 0, sourceRefs: [] as string[] };
        const matching = [...standard.tiers].sort((a, b) => (a.below ?? a.above ?? 0) - (b.below ?? b.above ?? 0)).find(tier =>
          tier.below !== undefined ? measurement.value < tier.below : tier.above !== undefined && measurement.value > tier.above
        );
        const proposedPenalty = matching?.amount ?? 0;
        const belowStandard = standard.minimum !== undefined ? measurement.value < standard.minimum : standard.maximum !== undefined && measurement.value > standard.maximum;
        const outcome = proposedPenalty === 0 ? (belowStandard ? "warning" : "meets") : proposedPenalty === Math.max(...standard.tiers.map(tier => tier.amount)) ? "tier2" : "tier1";
        return { standardId: standard.id, outcome, proposedPenalty, sourceRefs: [measurement.sourceRef] };
      });
      const proposedTotal = items.reduce((total, item) => total + item.proposedPenalty, 0);
      const partial = items.some(item => item.outcome === "not_assessable");
      period.items = items;
      period.state = "under_review";
      period.audit.push({ action: "computed", actor: "system" });
      return { id: period.id, agreementId: period.agreementId, month: period.month, monthLabel: monthLabel(period.month), state: "under_review", ruleSetId: input.ruleSet.id, items, proposedTotal, totalLabel: partial ? "Partial assessed total" : "Proposed total" };
    },
    review(periodId: string, standardId: string, decision: { reviewer: string; action: "confirm" | "adjust" | "waive" }) {
      const period = periods.get(periodId);
      if (!period?.items?.some(item => item.standardId === standardId)) throw new Error("Assessment Item not found");
      period.reviews.push({ standardId, ...decision });
      period.audit.push({ action: "reviewed", actor: decision.reviewer });
    },
    shareValidationDraft(periodId: string, sharing: { actor: string; recipient: string; method: string; sharedAt: string }) {
      const period = periods.get(periodId);
      if (!period || period.reviews.length !== period.items?.length) throw new Error("Every Assessment Item requires review");
      const ends = addBusinessDays(new Date(sharing.sharedAt), 5, new Set(input.holidays ?? []));
      period.validationEndsOn = ends.toISOString().slice(0, 10);
      period.state = "in_validation";
      period.audit.push({ action: "validation_shared", actor: sharing.actor });
      return { validationEndsOn: period.validationEndsOn };
    },
    finalize(periodId: string, decision: { issuer: string; at?: string }) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      if (period.reviews.some(review => review.reviewer === decision.issuer)) throw new Error("Review and issuance require separate people");
      if (!period.validationEndsOn || (decision.at ?? new Date().toISOString()).slice(0, 10) < period.validationEndsOn) throw new Error("Validation Window has not ended");
      period.state = "finalized";
      period.audit.push({ action: "finalized", actor: decision.issuer });
    },
    issue(periodId: string, issuance: { issuer: string; recipient: string; method: string; at: string }) {
      const period = periods.get(periodId);
      if (!period || period.state !== "finalized") throw new Error("Only a Finalized Assessment can be issued");
      const officialArtifact = `<!doctype html><html><body><h1>Final Assessment</h1><p>${input.agreement.contractorName}</p><p>${monthLabel(period.month)}</p></body></html>`;
      const contentSha256 = createHash("sha256").update(officialArtifact).digest("hex");
      period.state = "issued";
      period.audit.push({ action: "issued", actor: issuance.issuer });
      return { state: period.state, officialArtifact, contentSha256 };
    },
    audit(periodId: string) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      return [...period.audit];
    },
  };
}
import { createHash } from "node:crypto";
import { addBusinessDays } from "./assessment/businessDays";
