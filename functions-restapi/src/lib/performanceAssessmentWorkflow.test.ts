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
  const issued = workflow.issue(period.id, {
    issuer: "manager@mvta.us",
    recipient: "contractor@example.com",
    method: "email",
    at: "2026-08-10T15:05:00Z",
  });

  assert.equal(issued.state, "issued");
  assert.equal(issued.officialArtifact.includes("Ramp-up"), false);
  assert.match(issued.contentSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(workflow.audit(period.id).map(entry => entry.action), ["opened", "computed", "reviewed", "validation_shared", "finalized", "issued"]);
});
