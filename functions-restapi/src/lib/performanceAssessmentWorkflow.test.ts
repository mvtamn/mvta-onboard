import assert from "node:assert/strict";
import test from "node:test";
import { createPerformanceAssessmentWorkflow } from "./performanceAssessmentWorkflow";

test("opens and computes an Agreement-scoped Assessment Period without ramp-up", () => {
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: {
      id: "rules-2026",
      standards: [{ id: "otp", name: "Fixed-route OTP", minimum: 85, tiers: [{ below: 75, amount: 3500 }, { below: 80, amount: 1500 }] }],
    },
  });

  const period = workflow.open("2026-07");
  workflow.recordMeasurement(period.id, { standardId: "otp", value: 79, sourceRef: "otp:2026-07" });
  const computed = workflow.compute(period.id);

  assert.deepEqual(computed, {
    id: period.id,
    agreementId: "agreement-1",
    month: "2026-07",
    monthLabel: "July 2026",
    state: "under_review",
    ruleSetId: "rules-2026",
    items: [{ standardId: "otp", outcome: "tier1", proposedPenalty: 1500, sourceRefs: ["otp:2026-07"] }],
    proposedTotal: 1500,
    totalLabel: "Proposed total",
  });
  assert.equal("rampUp" in computed, false);
});

test("does not treat unresolved candidates or missing measurements as compliant", () => {
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: {
      id: "rules-2026",
      standards: [
        { id: "otp", name: "Fixed-route OTP", minimum: 85, tiers: [] },
        { id: "missed", name: "Missed trips", maximum: 0, tiers: [{ above: 0, amount: 1000 }] },
      ],
    },
  });
  const period = workflow.open("2026-07");
  workflow.recordMeasurement(period.id, { standardId: "otp", value: 90, sourceRef: "otp:2026-07" });
  const candidate = workflow.recordCandidate(period.id, { standardId: "missed", sourceRef: "trip:44" });

  assert.throws(() => workflow.compute(period.id), /unresolved candidate/i);
  workflow.resolveCandidate(period.id, candidate.id, "deferred");
  const computed = workflow.compute(period.id);

  assert.deepEqual(computed.items.map(item => ({ standardId: item.standardId, outcome: item.outcome })), [
    { standardId: "otp", outcome: "meets" },
    { standardId: "missed", outcome: "not_assessable" },
  ]);
  assert.equal(computed.totalLabel, "Partial assessed total");
});

test("requires separate review, validation sharing, and issuance authority", () => {
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: { id: "rules-2026", standards: [{ id: "otp", name: "Fixed-route OTP", minimum: 85, tiers: [{ below: 80, amount: 1500 }] }] },
    holidays: [],
  });
  const period = workflow.open("2026-07");
  workflow.recordMeasurement(period.id, { standardId: "otp", value: 79, sourceRef: "otp:2026-07" });
  workflow.compute(period.id);
  workflow.review(period.id, "otp", { reviewer: "reviewer@mvta.us", action: "confirm" });

  assert.throws(() => workflow.finalize(period.id, { issuer: "reviewer@mvta.us" }), /separate/i);
  const draft = workflow.shareValidationDraft(period.id, {
    actor: "reviewer@mvta.us",
    recipient: "contractor@example.com",
    method: "email",
    sharedAt: "2026-08-03T15:00:00Z",
  });
  assert.equal(draft.validationEndsOn, "2026-08-10");
  assert.throws(() => workflow.finalize(period.id, { issuer: "manager@mvta.us", at: "2026-08-07T15:00:00Z" }), /validation window/i);

  workflow.finalize(period.id, { issuer: "manager@mvta.us", at: "2026-08-10T15:00:00Z" });
  workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  const issued = workflow.issue(period.id, {
    issuer: "manager@mvta.us",
    recipient: "contractor@example.com",
    method: "email",
    at: "2026-08-10T15:05:00Z",
  });

  assert.equal(issued.state, "issued");
  assert.equal(issued.officialArtifact.includes("Ramp-up"), false);
  assert.match(issued.contentSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(workflow.audit(period.id).map(entry => entry.action), ["opened", "computed", "reviewed", "validation_shared", "finalized", "issuance_proof_prepared", "issued"]);
});

// The road to an issued month, shared by the Issuance Proof tests below.
function finalizedPeriod(standards = [{ id: "otp", name: "Fixed-route OTP", minimum: 85, tiers: [{ below: 80, amount: 1500 }] }]) {
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: { id: "rules-2026", standards },
    holidays: [],
  });
  const period = workflow.open("2026-07");
  for (const standard of standards) workflow.recordMeasurement(period.id, { standardId: standard.id, value: 79, sourceRef: `${standard.id}:2026-07` });
  workflow.compute(period.id);
  for (const standard of standards) workflow.review(period.id, standard.id, { reviewer: "reviewer@mvta.us", action: "confirm" });
  workflow.shareValidationDraft(period.id, { actor: "reviewer@mvta.us", recipient: "contractor@example.com", method: "email", sharedAt: "2026-08-03T15:00:00Z" });
  workflow.finalize(period.id, { issuer: "manager@mvta.us", at: "2026-08-10T15:00:00Z" });
  return { workflow, period };
}

test("an Issuance Proof is prepared from a Finalized Assessment and is not itself a Final Assessment", () => {
  const { workflow, period } = finalizedPeriod();
  const proof = workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  assert.equal(proof.kind, "issuance_proof");
  assert.equal(proof.version, 1);
  assert.match(proof.contentSha256, /^[a-f0-9]{64}$/);
  // Preparing a proof issues nothing: the period is still only finalized.
  assert.equal(workflow.artifacts(period.id).every(artifact => artifact.issuedAt === null), true);
});

test("issuance requires a live Issuance Proof", () => {
  const { workflow, period } = finalizedPeriod();
  assert.throws(() => workflow.issue(period.id, { issuer: "manager@mvta.us", recipient: "c@example.com", method: "email", at: "2026-08-10T15:05:00Z" }), /issuance proof/i);
});

test("preparing another proof voids the first, and both keep their Report Version", () => {
  const { workflow, period } = finalizedPeriod();
  workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  const second = workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  assert.equal(second.version, 2);
  assert.deepEqual(workflow.artifacts(period.id).map(a => ({ version: a.version, voided: a.voidedAt !== null })), [
    { version: 1, voided: true },
    { version: 2, voided: false },
  ]);
  assert.ok(workflow.audit(period.id).some(entry => entry.action === "issuance_proof_voided"));
});

test("issuing turns the live proof into the Final Assessment and keeps the proof beside it", () => {
  const { workflow, period } = finalizedPeriod();
  const proof = workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  const issued = workflow.issue(period.id, { issuer: "manager@mvta.us", recipient: "c@example.com", method: "email", at: "2026-08-10T15:05:00Z" });
  assert.equal(issued.state, "issued");
  const [artifact] = workflow.artifacts(period.id);
  assert.equal(artifact.kind, "final_assessment");
  assert.equal(artifact.version, proof.version);
  assert.equal(artifact.proofSha256, proof.contentSha256);
  // The issued bytes carry the issuer and deadline, so they are not the proof's bytes.
  assert.notEqual(artifact.contentSha256, artifact.proofSha256);
  assert.equal(artifact.contentSha256, issued.contentSha256);
});

test("reopening a Finalized Assessment voids its live proof", () => {
  const { workflow, period } = finalizedPeriod();
  workflow.prepareIssuanceProof(period.id, { actor: "manager@mvta.us" });
  workflow.reopen(period.id, { actor: "manager@mvta.us", reason: "Late evidence" });
  assert.equal(workflow.artifacts(period.id)[0].voidedAt !== null, true);
  assert.throws(() => workflow.issue(period.id, { issuer: "manager@mvta.us", recipient: "c@example.com", method: "email", at: "2026-08-11T15:05:00Z" }), /finalized/i);
});

test("a standard assigned after the period opened waits for the next period", () => {
  const standards = [{ id: "otp", name: "Fixed-route OTP", minimum: 85, tiers: [{ below: 80, amount: 1500 }] }];
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: { id: "rules-2026", standards },
    holidays: [],
  });
  const july = workflow.open("2026-07");
  standards.push({ id: "missed", name: "Missed trips", minimum: 0, tiers: [] });
  workflow.recordMeasurement(july.id, { standardId: "otp", value: 90, sourceRef: "otp:2026-07" });
  const computed = workflow.compute(july.id);
  assert.deepEqual(computed.items.map(item => item.standardId), ["otp"]);
  workflow.review(july.id, "otp", { reviewer: "reviewer@mvta.us", action: "confirm" });
  workflow.shareValidationDraft(july.id, { actor: "reviewer@mvta.us", recipient: "c@example.com", method: "email", sharedAt: "2026-08-03T15:00:00Z" });
  workflow.finalize(july.id, { issuer: "manager@mvta.us", at: "2026-08-10T15:00:00Z" });
  const august = workflow.open("2026-08");
  workflow.recordMeasurement(august.id, { standardId: "otp", value: 90, sourceRef: "otp:2026-08" });
  assert.deepEqual(workflow.compute(august.id).items.map(item => item.standardId), ["otp", "missed"]);
});

test("an Agreement with no scored standard cannot finalize an empty month", () => {
  const workflow = createPerformanceAssessmentWorkflow({
    agreement: { id: "agreement-1", contractorName: "Transit Operations", startsOn: "2026-01-01", endsOn: "2026-12-31" },
    ruleSet: { id: "rules-2026", standards: [] },
    holidays: [],
  });
  const period = workflow.open("2026-07");
  workflow.compute(period.id);
  workflow.shareValidationDraft(period.id, { actor: "reviewer@mvta.us", recipient: "c@example.com", method: "email", sharedAt: "2026-08-03T15:00:00Z" });
  assert.throws(() => workflow.finalize(period.id, { issuer: "manager@mvta.us", at: "2026-08-10T15:00:00Z" }), /assessment item/i);
});
