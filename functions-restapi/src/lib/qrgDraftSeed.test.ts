import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROPOSED_CRITERIA,
  MAX_QRG_PAGES,
  PROPOSAL_TIMEOUT_MS,
  SeedRefusal,
  seedDraftFromQrg,
  validateProposal,
  type GuidanceProposer,
  type QrgRead,
  type QrgSource,
  type SeedInput,
} from "./qrgDraftSeed";

const ETAG = '"{QRG-1},3"';

const input = (overrides: Partial<SeedInput> = {}): SeedInput => ({
  procedure_id: "dm-bridge-strike",
  condition_key: "bridge-strike",
  condition: "Vehicle strikes a bridge",
  qrg: { item_id: "item-qrg", seen_version: ETAG, document_code: "QRG-014" },
  primary: { item_id: "item-sop", seen_version: '"{SOP-1},1"', document_code: "SOP-014", document_type: "SOP" },
  ...overrides,
});

/** A library holding one QRG, or refusing with a given failure. */
function source(answer: QrgRead | { failure: "forbidden" | "not_found" | "failed" | "unconfigured"; reason: string }): QrgSource {
  return { read: async () => answer };
}

const pdf: QrgRead = { name: "Bridge strike QRG.pdf", mime: "application/pdf", seen_version: ETAG, bytes: new Uint8Array([1, 2, 3]) };

function proposer(answer: unknown | (() => Promise<unknown>), model = "test-model"): GuidanceProposer {
  return { model, propose: async () => (typeof answer === "function" ? (answer as () => Promise<unknown>)() : answer) };
}

const guidance = {
  condition: "Bridge strike (model wording)",
  severity: "Stop service",
  severity_meaning: "Hold the vehicle until an inspection clears it",
  criteria: [
    { kind: "applies", text: "The vehicle contacted a structure over the roadway" },
    { kind: "excludes", text: "Mirror contact with vegetation" },
  ],
  immediate_actions: [
    { kind: "required", instruction: "Stop the vehicle and set the brake" },
    { kind: "informational", instruction: "Dispatch notifies the bridge owner" },
  ],
};

test("a readable QRG with usable guidance seeds a Draft and records the proposal", async () => {
  const { draft, seeding } = await seedDraftFromQrg(input(), source(pdf), proposer(guidance));

  assert.equal(draft.procedure_id, "dm-bridge-strike");
  // The author's own condition wins over the model's wording.
  assert.equal(draft.condition, "Vehicle strikes a bridge");
  assert.equal(draft.severity, "Stop service");
  assert.deepEqual(draft.criteria.map((c) => c.kind), ["applies", "excludes"]);
  assert.equal(draft.immediate_actions.length, 2);

  // The governing SOP is primary; the QRG rides along as a QRG reference,
  // because supportingDocumentReferences refuses any other primary type.
  assert.deepEqual(draft.document_references.map((r) => [r.document_type, r.is_primary]), [["SOP", true], ["QRG", false]]);

  assert.equal(seeding.outcome, "proposed");
  assert.equal(seeding.outcome_reason, null);
  assert.equal(seeding.model, "test-model");
  assert.equal(seeding.pages_read, MAX_QRG_PAGES);
  assert.equal(seeding.qrg_name, "Bridge strike QRG.pdf");
  assert.equal(JSON.parse(seeding.proposed_json!).criteria.length, 2);
});

test("the model's condition is used only where the author left it blank", async () => {
  const { draft } = await seedDraftFromQrg(input({ condition: "" }), source(pdf), proposer(guidance));
  assert.equal(draft.condition, "Bridge strike (model wording)");
});

test("a QRG OnBoard cannot read refuses the whole seeding, with the status the reason deserves", async () => {
  const cases = [
    { failure: "forbidden" as const, reason: "SharePoint refused OnBoard's read of this library.", status: 409 },
    { failure: "unconfigured" as const, reason: "No Approved Document Library is configured.", status: 409 },
    { failure: "not_found" as const, reason: "SharePoint has no item with that id.", status: 400 },
    { failure: "failed" as const, reason: "SharePoint could not be reached.", status: 503 },
  ];
  for (const { failure, reason, status } of cases) {
    await assert.rejects(
      () => seedDraftFromQrg(input(), source({ failure, reason }), proposer(guidance)),
      (error: unknown) => error instanceof SeedRefusal && error.status === status && error.message === reason,
      `${failure} should refuse with ${status}`,
    );
  }
});

test("a QRG in a format OnBoard cannot show is refused rather than guessed at", async () => {
  const docx = { ...pdf, name: "Bridge strike.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  await assert.rejects(
    () => seedDraftFromQrg(input(), source(docx), proposer(guidance)),
    (error: unknown) => error instanceof SeedRefusal && error.status === 400 && /PNG, JPEG or PDF/.test(error.message),
  );
});

test("a QRG revised after the author chose it is refused, so guidance and reference cannot disagree", async () => {
  await assert.rejects(
    () => seedDraftFromQrg(input(), source({ ...pdf, seen_version: '"{QRG-1},4"' }), proposer(guidance)),
    (error: unknown) => error instanceof SeedRefusal && error.status === 409 && /changed in SharePoint/.test(error.message),
  );
});

test("the same document cannot be both the QRG and the governing document", async () => {
  const same = input({ primary: { item_id: "item-qrg", seen_version: ETAG, document_code: "SOP-014", document_type: "SOP" } });
  await assert.rejects(
    () => seedDraftFromQrg(same, source(pdf), proposer(guidance)),
    (error: unknown) => error instanceof SeedRefusal && error.status === 400,
  );
});

test("a model that throws still leaves the author an empty Draft with the QRG attached", async () => {
  const { draft, seeding } = await seedDraftFromQrg(
    input(),
    source(pdf),
    proposer(() => Promise.reject(new Error("upstream 529"))),
  );
  assert.deepEqual(draft.criteria, []);
  assert.deepEqual(draft.immediate_actions, []);
  assert.deepEqual(draft.document_references.map((r) => r.document_type), ["SOP", "QRG"]);
  assert.equal(seeding.outcome, "empty");
  assert.equal(seeding.proposed_json, null);
  assert.match(seeding.outcome_reason!, /upstream 529/);
});

test("a model that never answers is abandoned at the timeout, not left on the worker", async () => {
  const started = Date.now();
  const { seeding } = await seedDraftFromQrg(
    input(),
    source(pdf),
    // Never resolves. The seeding must come back on the timeout alone.
    proposer(() => new Promise(() => {})),
    { timeoutMs: 40 },
  );
  assert.equal(seeding.outcome, "empty");
  assert.match(seeding.outcome_reason!, /took longer than/);
  assert.ok(Date.now() - started < 5_000, "it should not have waited for an answer that never came");
});

test("the production timeout is the one used when nothing overrides it", () => {
  assert.equal(PROPOSAL_TIMEOUT_MS, 25_000);
  assert.equal(MAX_QRG_PAGES, 4);
});

test("unusable answers each explain themselves and yield an empty Draft", async () => {
  const unusable: [unknown, RegExp][] = [
    ["not an object", /did not return a guidance object/],
    [{ criteria: [], immediate_actions: "no" }, /no criteria and immediate_actions arrays/],
    [{ criteria: [], immediate_actions: [] }, /proposed no criteria and no immediate actions/],
    [{ criteria: [{ kind: "maybe", text: "x" }], immediate_actions: [] }, /applies\/excludes kind and text/],
    [{ criteria: [], immediate_actions: [{ kind: "required", instruction: "   " }] }, /required, conditional, or informational/],
    [{ ...guidance, severity: "Cancel everything" }, /severity OnBoard does not use/],
  ];
  for (const [answer, expected] of unusable) {
    const { draft, seeding } = await seedDraftFromQrg(input(), source(pdf), proposer(answer));
    assert.equal(seeding.outcome, "empty", `${JSON.stringify(answer)} should be unusable`);
    assert.match(seeding.outcome_reason!, expected);
    assert.deepEqual(draft.criteria, []);
  }
});

test("an enum returned in different capitalization is accepted and stored in OnBoard's spelling", async () => {
  // Structured outputs documents that enum values may come back cased
  // differently and must be compared case-insensitively.
  const shouted = {
    severity: "STOP SERVICE",
    criteria: [{ kind: "Applies", text: "The vehicle contacted a structure" }],
    immediate_actions: [{ kind: "REQUIRED", instruction: "Stop the vehicle" }],
  };
  const { draft, seeding } = await seedDraftFromQrg(input(), source(pdf), proposer(shouted));
  assert.equal(seeding.outcome, "proposed");
  assert.equal(draft.severity, "Stop service");
  assert.equal(draft.criteria[0].kind, "applies");
  assert.equal(draft.immediate_actions[0].kind, "required");
});

test("an omitted or empty severity is simply absent, not an unusable answer", async () => {
  for (const severity of [undefined, null, ""]) {
    const { draft, seeding } = await seedDraftFromQrg(input(), source(pdf), proposer({ ...guidance, severity }));
    assert.equal(seeding.outcome, "proposed", `severity ${JSON.stringify(severity)} should be allowed`);
    assert.equal(draft.severity, undefined);
  }
});

test("validateProposal holds a proposal to the same vocabulary and limits as a typed Draft", () => {
  const long = validateProposal({
    criteria: [{ kind: "applies", text: "a".repeat(2000) }],
    immediate_actions: [{ kind: "required", instruction: "b".repeat(5000) }],
  });
  assert.ok(!("error" in long));
  assert.equal(long.criteria[0].text.length, 1000, "criterion text is cut to its column");
  assert.equal(long.immediate_actions[0].instruction.length, 2000, "instruction is cut to its column");

  const runaway = validateProposal({
    criteria: Array.from({ length: MAX_PROPOSED_CRITERIA + 1 }, () => ({ kind: "applies", text: "x" })),
    immediate_actions: [],
  });
  assert.ok("error" in runaway && /more than/.test(runaway.error));

  // Trimming, not rejecting, is the rule for whitespace around real content.
  const padded = validateProposal({ criteria: [{ kind: "applies", text: "  spaced  " }], immediate_actions: [] });
  assert.ok(!("error" in padded));
  assert.equal(padded.criteria[0].text, "spaced");
});
