import { test } from "node:test";
import assert from "node:assert";
import { channelRequested, teamsTargets } from "./deliveryChannels";

test("legacy null channels enable subscriber delivery", () => {
  assert.strictEqual(channelRequested(null, "SMS"), true);
  assert.strictEqual(channelRequested([], "Email"), true);
});

test("channel matching is explicit and case insensitive", () => {
  assert.strictEqual(channelRequested(["Website", "sms"], "SMS"), true);
  assert.strictEqual(channelRequested(["Website", "Email"], "SMS"), false);
});

test("Teams-only alerts do not request SMS or email", () => {
  const channels = ["Teams: Operations", "Teams: Customer Service"];
  assert.strictEqual(channelRequested(channels, "SMS"), false);
  assert.strictEqual(channelRequested(channels, "Email"), false);
});

test("Teams targets are extracted for the future connector", () => {
  assert.deepStrictEqual(
    teamsTargets(["Website", "Teams: Operations", "teams: Customer Service"]),
    ["Operations", "Customer Service"],
  );
});
