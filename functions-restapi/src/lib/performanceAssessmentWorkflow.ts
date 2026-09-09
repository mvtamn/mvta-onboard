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

// One archived render for a period. An Issuance Proof is what the Issuing
// Authority checks; issuing transitions that same artifact into the Final
// Assessment and keeps the proof's hash beside the issued one (ADR 0029).
export interface AssessmentArtifact {
  kind: "issuance_proof" | "final_assessment";
  version: number;
  contentSha256: string;
  proofSha256: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
}

interface AssessmentPeriod {
  id: string;
  agreementId: string;
  month: string;
  // The Assessment Rule Set frozen at open; a standard assigned to the
  // Agreement later governs a later period (ADR 0006).
  standards: AssessmentStandard[];
  artifacts: AssessmentArtifact[];
  measurements: Measurement[];
  candidates: Array<{ id: string; standardId: string; sourceRef: string; resolution: "unresolved" | "confirmed" | "dismissed" | "deferred" }>;
  items?: Array<{ standardId: string; outcome: string; proposedPenalty: number; sourceRefs: string[] }>;
  reviews: Array<{ standardId: string; reviewer: string; action: "confirm" | "adjust" | "waive" }>;
  validationEndsOn?: string;
  state: "open" | "under_review" | "in_validation" | "finalized" | "reopened" | "issued";
  audit: Array<{ action: string; actor: string }>;
}

// Nothing is deleted: a superseded proof keeps its version and its bytes, and
// the audit says why it stopped being the one to check.
function voidLiveProof(period: AssessmentPeriod, actor: string, at: string) {
  for (const artifact of period.artifacts) {
    if (artifact.kind === "issuance_proof" && artifact.voidedAt === null) {
      artifact.voidedAt = at;
      period.audit.push({ action: "issuance_proof_voided", actor });
    }
  }
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
      const period: AssessmentPeriod = { id, agreementId: input.agreement.id, month, standards: [...input.ruleSet.standards], artifacts: [], measurements: [], candidates: [], reviews: [], state: "open", audit: [{ action: "opened", actor: "system" }] };
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
      const items = period.standards.map(standard => {
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
      // One Assessment Item per standard in the frozen Rule Set, and at least
      // one: a partial compute, or a month with nothing to score, is not a
      // Finalized Assessment.
      if (!period.items?.length || period.items.length !== period.standards.length) throw new Error("Finalization requires one Assessment Item per standard in the Assessment Rule Set");
      period.state = "finalized";
      period.audit.push({ action: "finalized", actor: decision.issuer });
    },
    prepareIssuanceProof(periodId: string, request: { actor: string; at?: string }) {
      const period = periods.get(periodId);
      if (!period || period.state !== "finalized") throw new Error("An Issuance Proof requires a Finalized Assessment");
      voidLiveProof(period, request.actor, request.at ?? new Date().toISOString());
      const render = `<!doctype html><html><body><h1>Issuance Proof</h1><p>${input.agreement.contractorName}</p><p>${monthLabel(period.month)}</p></body></html>`;
      const artifact: AssessmentArtifact = { kind: "issuance_proof", version: period.artifacts.length + 1, contentSha256: createHash("sha256").update(render).digest("hex"), proofSha256: null, issuedAt: null, voidedAt: null };
      period.artifacts.push(artifact);
      period.audit.push({ action: "issuance_proof_prepared", actor: request.actor });
      return { ...artifact };
    },
    issue(periodId: string, issuance: { issuer: string; recipient: string; method: string; at: string }) {
      const period = periods.get(periodId);
      if (!period || period.state !== "finalized") throw new Error("Only a Finalized Assessment can be issued");
      const proof = period.artifacts.find(artifact => artifact.kind === "issuance_proof" && artifact.voidedAt === null);
      if (!proof) throw new Error("Issuance requires a live Issuance Proof");
      const officialArtifact = `<!doctype html><html><body><h1>Final Assessment</h1><p>${input.agreement.contractorName}</p><p>${monthLabel(period.month)}</p><p>Issued by ${issuance.issuer} on ${issuance.at}</p></body></html>`;
      const contentSha256 = createHash("sha256").update(officialArtifact).digest("hex");
      proof.kind = "final_assessment";
      proof.proofSha256 = proof.contentSha256;
      proof.contentSha256 = contentSha256;
      proof.issuedAt = issuance.at;
      period.state = "issued";
      period.audit.push({ action: "issued", actor: issuance.issuer });
      return { state: period.state, officialArtifact, contentSha256 };
    },
    reopen(periodId: string, decision: { actor: string; reason: string; at?: string }) {
      const period = periods.get(periodId);
      if (!period || period.state !== "finalized") throw new Error("Only a Finalized Assessment can be reopened in place");
      voidLiveProof(period, decision.actor, decision.at ?? new Date().toISOString());
      period.state = "reopened";
      period.audit.push({ action: "reopened", actor: decision.actor });
    },
    artifacts(periodId: string) {
      const period = periods.get(periodId);
      if (!period) throw new Error("Assessment Period not found");
      return period.artifacts.map(artifact => ({ ...artifact }));
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
