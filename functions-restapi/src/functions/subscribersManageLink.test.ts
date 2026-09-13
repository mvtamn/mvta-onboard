import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import type { ManageLinkResult } from "../lib/subscriberPreferences";
import type { ManageLinkRequestedEvent } from "../lib/types";
import { contactsFrom, requestManageLinkHandler, setManageLinkGatewayForTests } from "./subscribersManageLink";

// The lookup, the confirmed-only rule and the throttle have contract tests
// (lib/subscriberManageLink.db.contract.test.ts). What is tested here is the
// HTTP shell's own decisions, which are almost entirely about what an
// anonymous caller can learn from the answer.

const errors: unknown[][] = [];
const context = {
  error: (...args: unknown[]) => errors.push(args),
  warn: () => undefined,
  log: () => undefined,
} as unknown as InvocationContext;

const EVENT: ManageLinkRequestedEvent = {
  kind: "manage_link",
  subscriber_id: "11111111-1111-1111-1111-111111111111",
  channel: "sms",
  manage_key: "a".repeat(64),
  phone_number: "+19523883275",
  email: null,
};

/** A gateway that answers with the given results in turn and records publishes. */
function gateway(...results: (ManageLinkResult | Error)[]) {
  const calls: string[] = [];
  const published: ManageLinkRequestedEvent[] = [];
  let i = 0;
  setManageLinkGatewayForTests({
    withTransaction: async () => {
      calls.push("transaction");
      const next = results[i++];
      if (next instanceof Error) throw next;
      return next as never;
    },
    publish: async (event) => {
      calls.push("publish");
      published.push(event);
      return true;
    },
  });
  return { calls, published };
}

function post(body: unknown, raw?: string): HttpRequest {
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/subscribers/manage-link",
    headers: { "content-type": "application/json" },
    body: { string: raw ?? JSON.stringify(body) },
  });
}

afterEach(() => {
  setManageLinkGatewayForTests(null);
  errors.length = 0;
});

test("every outcome gets the same answer, so the endpoint cannot say who is subscribed", async () => {
  const answers = [];
  for (const result of [
    { outcome: "issued", event: EVENT },
    { outcome: "too_soon" },
    { outcome: "nothing_confirmed" },
  ] as ManageLinkResult[]) {
    gateway(result);
    answers.push(await requestManageLinkHandler(post({ phone_number: "(952) 388-3275" }), context));
  }
  // A failure inside, too: an error that answered differently would be a
  // difference worth probing for.
  gateway(new Error("database down"));
  answers.push(await requestManageLinkHandler(post({ phone_number: "(952) 388-3275" }), context));

  for (const answer of answers) {
    assert.deepEqual(answer, { status: 200, jsonBody: { status: "ok" } });
  }
});

test("a link is published only when one was issued, and only after the commit", async () => {
  const issued = gateway({ outcome: "issued", event: EVENT });
  await requestManageLinkHandler(post({ phone_number: "+19523883275" }), context);
  assert.deepEqual(issued.calls, ["transaction", "publish"]);
  assert.deepEqual(issued.published, [EVENT]);

  for (const outcome of ["too_soon", "nothing_confirmed"] as const) {
    const quiet = gateway({ outcome });
    await requestManageLinkHandler(post({ phone_number: "+19523883275" }), context);
    assert.deepEqual(quiet.published, [], `${outcome} sends nothing`);
  }
});

test("a number is normalized before it is looked up, and one that cannot be read is dropped", () => {
  // The API stores E.164; "(952) 388-3275" arriving unchanged matches no row.
  assert.deepEqual(contactsFrom({ phone_number: "(952) 388-3275" }), [["sms", "+19523883275"]]);
  assert.deepEqual(contactsFrom({ phone_number: "555-0142" }), []);
  assert.deepEqual(contactsFrom({ email: "  rider@example.com " }), [["email", "rider@example.com"]]);
  assert.deepEqual(contactsFrom({ phone_number: 9523883275, email: "" }), []);
});

test("a request with no usable contact touches nothing and still answers the same", async () => {
  const { calls } = gateway();
  const answer = await requestManageLinkHandler(post({}), context);
  assert.deepEqual(calls, []);
  assert.deepEqual(answer, { status: 200, jsonBody: { status: "ok" } });
});

test("both contacts are tried, and one failing does not stop the other", async () => {
  const run = gateway(new Error("sms side broke"), { outcome: "issued", event: { ...EVENT, channel: "email", phone_number: null, email: "rider@example.com" } });
  const answer = await requestManageLinkHandler(post({ phone_number: "+19523883275", email: "rider@example.com" }), context);
  assert.deepEqual(run.calls, ["transaction", "transaction", "publish"]);
  assert.equal(run.published[0].channel, "email");
  assert.deepEqual(answer, { status: 200, jsonBody: { status: "ok" } });
});

test("a failure is logged by channel and never by the contact", async () => {
  gateway(new Error("boom"));
  await requestManageLinkHandler(post({ phone_number: "+19523883275" }), context);
  assert.equal(errors.length, 1);
  assert.ok(!JSON.stringify(errors[0].slice(0, 1)).includes("9523883275"), "the contact stays out of the logs");
});

test("malformed JSON is refused, which says nothing about any contact", async () => {
  gateway();
  const answer = await requestManageLinkHandler(post(undefined, "{not json"), context);
  assert.equal(answer.status, 400);
});
