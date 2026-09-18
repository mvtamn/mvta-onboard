import assert from "node:assert/strict";
import test from "node:test";
import { communicationEligibility, communicationStatus } from "./eligibility";
import { classifyCommunication, communicationStateSql } from "./state";
import { fakeDeliveryPort, teamsDeliveryPort, emailDeliveryPort } from "./delivery";
import type { CommunicationDetour } from "./types";

const fulfilled: CommunicationDetour = {
  lifecycle_state: "fulfilled",
  fulfillment_mode: "avail",
  re_review_outstanding: false,
  conflict_status: "none",
  required_audiences: ["Riders", "Metro Transit"],
};
const toRiders = { audience: "Riders", channel: "email", recipients: ["rider-alerts@example.com"] };

test("a fulfilled Detour with nothing outstanding may tell its audience", () => {
  const eligibility = communicationEligibility(fulfilled, toRiders);
  assert.deepEqual([eligibility.may_draft, eligibility.may_send, eligibility.refusal, eligibility.audience_not_required], [true, true, null, false]);
});

test("the refusal names the one thing to fix first", () => {
  // Order matters: a dispatcher told to complete a re-review should not then
  // be told about a conflict as well.
  const cases: [Partial<CommunicationDetour>, string][] = [
    [{ lifecycle_state: "closed", re_review_outstanding: true }, "detour_closed"],
    [{ re_review_outstanding: true, conflict_status: "unresolved" }, "re_review_outstanding"],
    [{ lifecycle_state: "fulfillment_failed" }, "fulfillment_failed"],
    [{ lifecycle_state: "awaiting_fulfillment" }, "fulfillment_pending"],
    [{ conflict_status: "unresolved" }, "conflict_unresolved"],
  ];
  for (const [overrides, code] of cases) {
    const eligibility = communicationEligibility({ ...fulfilled, ...overrides }, toRiders);
    assert.equal(eligibility.may_send, false, code);
    assert.equal(eligibility.refusal?.code, code);
    assert.ok((eligibility.refusal?.sentence.length ?? 0) > 20, `${code} needs a usable sentence`);
  }
});

test("wording may be prepared before a Detour is in place, but not after it closes", () => {
  assert.equal(communicationEligibility({ ...fulfilled, lifecycle_state: "awaiting_fulfillment" }, toRiders).may_draft, true);
  assert.equal(communicationEligibility({ ...fulfilled, lifecycle_state: "closed" }, toRiders).may_draft, false);
});

test("an email with nobody to send it to is refused; Teams carries no recipients", () => {
  assert.equal(communicationEligibility(fulfilled, { ...toRiders, recipients: [] }).refusal?.code, "no_recipients");
  assert.equal(communicationEligibility(fulfilled, { audience: "Riders", channel: "Teams", recipients: [] }).may_send, true);
});

test("an audience the record does not require is allowed, and said so", () => {
  const extra = communicationEligibility(fulfilled, { ...toRiders, audience: "City of Burnsville" });
  assert.deepEqual([extra.may_send, extra.audience_not_required], [true, true]);
  // Matching is how a person reads it, so case and spacing do not make a new audience.
  assert.equal(communicationEligibility(fulfilled, { ...toRiders, audience: " riders " }).audience_not_required, false);
});

test("a Detour reaches published only when every required audience has been told", () => {
  assert.equal(communicationStatus({ required: 2, published: 2, drafts: 0 }), "published");
  assert.equal(communicationStatus({ required: 2, published: 1, drafts: 1 }), "draft");
  assert.equal(communicationStatus({ required: 2, published: 1, drafts: 0 }), "needs_communication");
  // Nothing required is not "published": there is nothing to have done.
  assert.equal(communicationStatus({ required: 0, published: 0, drafts: 0 }), "needs_communication");
});

test("a communication's state comes from what the provider reported", () => {
  const cases: [string, string | null, string, boolean][] = [
    ["draft", null, "draft", false],
    ["published", "queued", "queued", false],
    ["published", "sent", "sent", true],
    ["published", "partially_sent", "sent", true],
    ["published", "failed", "failed", false],
    ["published", "skipped", "failed", false],
    // A person sent it themselves: published with no delivery of ours.
    ["published", null, "recorded", true],
    ["failed", null, "failed", false],
  ];
  for (const [status, delivery_status, state, counted] of cases) {
    assert.deepEqual(classifyCommunication({ status, delivery_status }), { state, counted }, `${status}/${delivery_status}`);
  }
  // Where migration 092 has not run there is no server-side delivery at all.
  assert.deepEqual(classifyCommunication({ status: "published", delivery_status: "failed" }, false), { state: "recorded", counted: true });
});

test("the SQL twin is built from checked aliases", () => {
  assert.throws(() => communicationStateSql("c; DROP"), TypeError);
  assert.throws(() => communicationStateSql("c", "x y"), TypeError);
  const fragment = communicationStateSql("c");
  for (const state of ["queued", "sent", "failed", "recorded", "draft"]) assert.match(fragment, new RegExp(`N'${state}'`));
  // Without migration 092 the fragment must not name a column that is absent.
  assert.doesNotMatch(communicationStateSql("c", "cst", false), /c\.delivery_status/);
});

test("the delivery port reports, and never writes", async () => {
  const fake = fakeDeliveryPort("email", { status: "queued" });
  const outcome = await fake.deliver({ communicationId: "c1", detourId: "d1", subject: "s", body: "b", recipients: ["a@example.com"] });
  assert.deepEqual(outcome, { status: "queued" });
  assert.deepEqual(fake.sent.map((m) => m.subject), ["s"]);

  // Teams: an unconfigured webhook is skipped, not failed - someone posts it
  // by hand and marks it published.
  const skipped = await teamsDeliveryPort(async () => ({ status: "skipped", error: "not configured" }))
    .deliver({ communicationId: "c1", detourId: "d1", subject: "s", body: "b", recipients: [] });
  assert.deepEqual(skipped, { status: "skipped", error: "not configured" });
  const failed = await teamsDeliveryPort(async () => ({ status: "failed", error: "webhook returned 500", transient: true }))
    .deliver({ communicationId: "c1", detourId: "d1", subject: "s", body: "b", recipients: [] });
  assert.deepEqual(failed, { status: "failed", error: "webhook returned 500", transient: true });

  // Email is queued for the dispatch app; an unconfigured queue is skipped.
  const context = {} as never;
  assert.deepEqual(await emailDeliveryPort(context, async () => true).deliver({ communicationId: "c1", detourId: "d1", subject: "s", body: "b", recipients: ["a@example.com"] }), { status: "queued" });
  const unconfigured = await emailDeliveryPort(context, async () => false).deliver({ communicationId: "c1", detourId: "d1", subject: "s", body: "b", recipients: ["a@example.com"] });
  assert.equal(unconfigured.status, "skipped");
});
