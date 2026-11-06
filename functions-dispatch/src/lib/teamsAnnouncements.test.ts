import { test } from "node:test";
import assert from "node:assert";
import { formatAnnouncementCard, postAnnouncementToTeams, teamsWebhookUrlFor } from "./teamsAnnouncements";

const OPS_URL = "https://example.invalid/workflows/operations";
const message = {
  category: "demand_response_delay",
  severity: "major",
  summary: "Route 420 detoured around the Cedar Ave closure.",
  routes_affected: ["420", "440"],
  zones_affected: null,
  expires_at: "2026-10-14T23:30:00.000Z",
};

function recordingFetch(status: number) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("each audience reads its own webhook, matched however the console spelled it", () => {
  const env = { TEAMS_OPERATIONS_WEBHOOK_URL: OPS_URL, TEAMS_CUSTOMER_SERVICE_WEBHOOK_URL: "https://example.invalid/cs" };
  assert.strictEqual(teamsWebhookUrlFor("Operations", env), OPS_URL);
  assert.strictEqual(teamsWebhookUrlFor(" customer  Service ", env), "https://example.invalid/cs");
  assert.strictEqual(teamsWebhookUrlFor("Maintenance", env), null);
});

test("an unresolved Key Vault reference is not configured, not a URL to post to", () => {
  const env = { TEAMS_OPERATIONS_WEBHOOK_URL: "@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/teams-operations-webhook-url/)" };
  assert.strictEqual(teamsWebhookUrlFor("Operations", env), null);
  assert.strictEqual(teamsWebhookUrlFor("Operations", {}), null);
});

test("the card carries the summary and the facts staff act on, expiry on MVTA's clock", () => {
  const card = formatAnnouncementCard(message);
  assert.strictEqual(card.type, "message");
  assert.strictEqual(card.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  const body = card.attachments[0].content.body as { type: string; text?: string; facts?: { title: string; value: string }[] }[];
  assert.strictEqual(body[1].text, message.summary);
  assert.deepStrictEqual(body[2].facts, [
    { title: "Category", value: "Demand response delay" },
    { title: "Severity", value: "Major" },
    { title: "Routes", value: "420, 440" },
    { title: "Expires", value: "Oct 14, 6:30 PM CT" },
  ]);
});

test("a posted announcement goes to the audience's webhook as the card", async () => {
  const { calls, impl } = recordingFetch(202);
  const outcome = await postAnnouncementToTeams("Operations", message, { TEAMS_OPERATIONS_WEBHOOK_URL: OPS_URL }, impl);
  assert.deepStrictEqual(outcome, { status: "sent" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, OPS_URL);
  assert.deepStrictEqual(calls[0].body, JSON.parse(JSON.stringify(formatAnnouncementCard(message))));
});

test("no channel set up is skipped without a request, and names the setting", async () => {
  const { calls, impl } = recordingFetch(202);
  const outcome = await postAnnouncementToTeams("Customer Service", message, {}, impl);
  assert.strictEqual(outcome.status, "skipped");
  assert.match((outcome as { error: string }).error, /TEAMS_CUSTOMER_SERVICE_WEBHOOK_URL/);
  assert.strictEqual(calls.length, 0);
});

test("a rejected or unreachable webhook is a failure, never sent", async () => {
  const rejected = await postAnnouncementToTeams("Operations", message, { TEAMS_OPERATIONS_WEBHOOK_URL: OPS_URL }, recordingFetch(400).impl);
  assert.deepStrictEqual(rejected, { status: "failed", error: "Teams webhook returned 400" });
  const down = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
  const unreachable = await postAnnouncementToTeams("Operations", message, { TEAMS_OPERATIONS_WEBHOOK_URL: OPS_URL }, down);
  assert.strictEqual(unreachable.status, "failed");
  assert.match((unreachable as { error: string }).error, /ENOTFOUND/);
});
