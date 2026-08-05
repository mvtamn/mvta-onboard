import { test } from "node:test";
import assert from "node:assert";
import { groupDetourReports, fetchDetours, type AvailDetourReport } from "./availDetoursFeed";

// Stubs global.fetch for the duration of one test, restoring it afterward -
// same convention as otpMonthlyFeed.test.ts's fetch stub.
function withFetchStub(response: unknown, run: () => Promise<void>): Promise<void> {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as unknown as typeof fetch;
  return run().finally(() => {
    global.fetch = original;
  });
}

// Fixture shaped after detour-module-build-brief.md's own sample: DetourID 30
// comes back as two rows, one per direction, sharing the same DetourID.
const DETOUR_30_INBOUND: AvailDetourReport = {
  DetourID: 30,
  DetourName: "5th St Construction",
  RouteID: 100,
  Direction: "Inbound",
  TurnByTurnMessage: "Turn right onto 49th St N",
  StartDate: "2026-08-01T00:00:00.0000000+00:00",
  EndDate: "2026-09-15T00:00:00.0000000+00:00",
  IsActive: true,
  Cause: "Construction",
  Effect: "Detour",
};

const DETOUR_30_OUTBOUND: AvailDetourReport = {
  ...DETOUR_30_INBOUND,
  Direction: "Outbound",
  TurnByTurnMessage: "Turn left onto Main St",
};

test("groups multiple direction rows sharing one DetourID into one Detour with N segments", () => {
  const grouped = groupDetourReports([DETOUR_30_INBOUND, DETOUR_30_OUTBOUND]);
  assert.strictEqual(grouped.length, 1);
  const detour = grouped[0];
  assert.strictEqual(detour.external_detour_id, "30");
  assert.strictEqual(detour.closure, "5th St Construction");
  assert.strictEqual(detour.start_date, "2026-08-01");
  assert.strictEqual(detour.end_date, "2026-09-15");
  assert.strictEqual(detour.segments.length, 2);
  assert.strictEqual(detour.segments[0].routes, "100 Inbound");
  assert.strictEqual(detour.segments[0].directions, "Turn right onto 49th St N");
  assert.strictEqual(detour.segments[1].routes, "100 Outbound");
});

test("keeps distinct DetourIDs as separate detours", () => {
  const grouped = groupDetourReports([
    DETOUR_30_INBOUND,
    { ...DETOUR_30_INBOUND, DetourID: 31, DetourName: "Main St Closure" },
  ]);
  assert.strictEqual(grouped.length, 2);
  assert.deepStrictEqual(
    grouped.map((d) => d.external_detour_id).sort(),
    ["30", "31"],
  );
});

test("falls back to a generated label when DetourName is blank", () => {
  const grouped = groupDetourReports([{ ...DETOUR_30_INBOUND, DetourName: "" }]);
  assert.strictEqual(grouped[0].closure, "Avail detour 30");
});

test("drops rows with no usable DetourID rather than throwing", () => {
  const grouped = groupDetourReports([{ ...DETOUR_30_INBOUND, DetourID: undefined as unknown as number }]);
  assert.strictEqual(grouped.length, 0);
});

test("builds a segment label from RouteID+Direction, falling back when both are missing", () => {
  const grouped = groupDetourReports([{ ...DETOUR_30_INBOUND, RouteID: null, Direction: null }]);
  assert.strictEqual(grouped[0].segments[0].routes, "Unknown route");
});

test("null/blank StartDate and EndDate map to null, not a malformed string", () => {
  const grouped = groupDetourReports([{ ...DETOUR_30_INBOUND, StartDate: null, EndDate: null }]);
  assert.strictEqual(grouped[0].start_date, null);
  assert.strictEqual(grouped[0].end_date, null);
});

test("fetchDetours returns the rows when the guessed envelope key matches", () =>
  withFetchStub({ success: true, errors: [], result: { Detours: [DETOUR_30_INBOUND] } }, async () => {
    const rows = await fetchDetours("https://example.test/Detours/v1/MVTA", "key");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].DetourID, 30);
  }));

test("fetchDetours throws naming the real key when the guessed key is wrong", () =>
  withFetchStub({ success: true, errors: [], result: { DetoursByProperty: [DETOUR_30_INBOUND] } }, async () => {
    await assert.rejects(
      () => fetchDetours("https://example.test/Detours/v1/MVTA", "key"),
      /DetoursByProperty/,
    );
  }));

test("fetchDetours returns an empty array when result is genuinely empty", () =>
  withFetchStub({ success: true, errors: [], result: {} }, async () => {
    const rows = await fetchDetours("https://example.test/Detours/v1/MVTA", "key");
    assert.deepStrictEqual(rows, []);
  }));
