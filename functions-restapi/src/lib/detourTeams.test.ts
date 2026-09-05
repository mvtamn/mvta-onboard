import { test } from "node:test";
import assert from "node:assert";
import { deliverDetourToTeams, formatDetourTeamsPayload } from "./detourTeams";

test("the Teams card leads with the subject and keeps the body as one wrapped block", () => {
  const payload = formatDetourTeamsPayload("[MVTA-DET-2026-0012] Detour: Cedar Ave", "Line 1\nLine 2");
  const body = (payload.attachments[0].content as { body: Array<{ type: string; text: string; weight?: string }> }).body;
  assert.equal(body.length, 2);
  assert.equal(body[0].text, "[MVTA-DET-2026-0012] Detour: Cedar Ave");
  assert.equal(body[0].weight, "Bolder");
  assert.equal(body[1].text, "Line 1\nLine 2");
});

test("delivery is skipped without a webhook, sent on 2xx, failed otherwise with transient classification", async () => {
  assert.deepStrictEqual((await deliverDetourToTeams("s", "b", {})).status, "skipped");
  const ok = await deliverDetourToTeams("s", "b", { TEAMS_DETOUR_WEBHOOK_URL: "https://example/hook" }, async () => new Response("1", { status: 200 }));
  assert.equal(ok.status, "sent");
  const throttled = await deliverDetourToTeams("s", "b", { TEAMS_DETOUR_WEBHOOK_URL: "https://example/hook" }, async () => new Response(null, { status: 429 }));
  assert.deepStrictEqual(throttled, { status: "failed", error: "Teams webhook returned 429", transient: true });
  const bad = await deliverDetourToTeams("s", "b", { TEAMS_DETOUR_WEBHOOK_URL: "https://example/hook" }, async () => new Response(null, { status: 400 }));
  assert.equal(bad.status, "failed"); assert.equal((bad as { transient: boolean }).transient, false);
  const down = await deliverDetourToTeams("s", "b", { TEAMS_DETOUR_WEBHOOK_URL: "https://example/hook" }, async () => { throw new Error("ECONNRESET"); });
  assert.equal(down.status, "failed"); assert.match((down as { error: string }).error, /unreachable/);
});
