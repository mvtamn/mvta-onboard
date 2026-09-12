import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { SMS_RECEIVED_EVENT, SUBSCRIPTION_VALIDATION_EVENT } from "../lib/inboundSms";
import { acsSmsEvents, setInboundSmsGatewayForTests } from "./acsSmsEvents";

// The webhook's own decisions. Classification has its own tests
// (lib/inboundSms.test.ts) and the state machine has contract tests; what is
// tested here is what happens around them - which call each intent makes, and
// what the endpoint answers when that call fails.

const logs: string[] = [];
const context = {
  log: (...args: unknown[]) => logs.push(args.join(" ")),
  warn: (...args: unknown[]) => logs.push(args.join(" ")),
  error: (...args: unknown[]) => logs.push(args.join(" ")),
} as unknown as InvocationContext;

/** Records every transaction the handler opens, answering with a fixed result. */
function gatewayReturning(result: unknown) {
  const opened: number[] = [];
  setInboundSmsGatewayForTests({
    withTransaction: async () => {
      opened.push(1);
      return result as never;
    },
  });
  return opened;
}

function gatewayThrowing(error: Error) {
  setInboundSmsGatewayForTests({
    withTransaction: async () => {
      throw error;
    },
  });
}

function eventRequest(body: unknown): HttpRequest {
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/acs-sms-events",
    headers: { "content-type": "application/json" },
    body: { string: JSON.stringify(body) },
  });
}

function smsEvent(from: string, message: string) {
  return { eventType: SMS_RECEIVED_EVENT, data: { from, to: "+18005550000", message } };
}

afterEach(() => setInboundSmsGatewayForTests(null));
beforeEach(() => (logs.length = 0));

test("the subscription handshake is answered before anything else happens", async () => {
  const opened = gatewayReturning({ changed: 1 });
  const response = await acsSmsEvents(
    eventRequest([{ eventType: SUBSCRIPTION_VALIDATION_EVENT, data: { validationCode: "abc-123" } }]),
    context,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { validationResponse: "abc-123" });
  assert.deepEqual(opened, [], "a handshake must not reach the database");
});

test("STOP stops the number that sent it", async () => {
  const opened = gatewayReturning({ changed: 2 });
  const response = await acsSmsEvents(eventRequest([smsEvent("+19523883275", "STOP")]), context);
  assert.equal(opened.length, 1);
  assert.deepEqual(response.jsonBody, { received: 1, confirmed: 0, stopped: 1, failed: 0 });
});

test("a STOP from a number that never subscribed is not a failure", async () => {
  // ACS relays STOP from anyone, so zero rows changed is a normal answer.
  gatewayReturning({ changed: 0 });
  const response = await acsSmsEvents(eventRequest([smsEvent("+19995550000", "stop")]), context);
  assert.equal((response.jsonBody as { failed: number }).failed, 0);
  assert.equal(response.status, 200);
});

test("a texted code confirms, and the full outcome is logged rather than replied to", async () => {
  // The sender's number is proven by the carrier here, unlike on
  // /confirm-sms, so the real outcome is safe to know. OnBoard still sends no
  // reply: ACS answers the mandatory keywords itself, and two systems
  // answering one text is how a loop starts.
  gatewayReturning({ outcome: "confirmed", subscriberId: "sub-1", channel: "sms" });
  const response = await acsSmsEvents(eventRequest([smsEvent("+19523883275", "123456")]), context);
  assert.deepEqual(response.jsonBody, { received: 1, confirmed: 1, stopped: 0, failed: 0 });
  assert.ok(logs.some((line) => line.includes("confirmed")));
});

test("a wrong code is recorded as what it was, and still answered 200", async () => {
  gatewayReturning({ outcome: "incorrect_code", subscriberId: "sub-1", channel: "sms" });
  const response = await acsSmsEvents(eventRequest([smsEvent("+19523883275", "999999")]), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { received: 1, confirmed: 0, stopped: 0, failed: 0 });
  assert.ok(logs.some((line) => line.includes("incorrect_code")));
});

test("a message that is neither reaches no database at all", async () => {
  const opened = gatewayReturning({ changed: 0 });
  const response = await acsSmsEvents(eventRequest([smsEvent("+19523883275", "when is the 444 due?")]), context);
  assert.deepEqual(opened, []);
  assert.deepEqual(response.jsonBody, { received: 1, confirmed: 0, stopped: 0, failed: 0 });
});

test("a number that cannot be read is ignored without a query", async () => {
  const opened = gatewayReturning({ changed: 0 });
  const response = await acsSmsEvents(eventRequest([smsEvent("not-a-number", "STOP")]), context);
  assert.deepEqual(opened, []);
  assert.equal(response.status, 200);
});

test("a failure is acknowledged, counted, and logged - never retried", async () => {
  // A non-200 makes Event Grid redeliver, and a message that fails for its own
  // reasons fails again. The count is in the response so the loss is visible
  // rather than silent.
  gatewayThrowing(new Error("deadlock"));
  const response = await acsSmsEvents(eventRequest([smsEvent("+19523883275", "STOP")]), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { received: 1, confirmed: 0, stopped: 0, failed: 1 });
  assert.ok(logs.some((line) => line.includes("could not be processed")));
});

test("one failing message does not stop the rest of the batch", async () => {
  let call = 0;
  setInboundSmsGatewayForTests({
    withTransaction: async () => {
      call += 1;
      if (call === 1) throw new Error("deadlock");
      return { changed: 1 } as never;
    },
  });
  const response = await acsSmsEvents(
    eventRequest([smsEvent("+19523883275", "STOP"), smsEvent("+16125550142", "STOP")]),
    context,
  );
  assert.deepEqual(response.jsonBody, { received: 2, confirmed: 0, stopped: 1, failed: 1 });
});

test("a body that is not JSON is the caller's error, and says so", async () => {
  const request = new HttpRequest({
    method: "POST",
    url: "https://example.test/api/acs-sms-events",
    headers: { "content-type": "application/json" },
    body: { string: "not json" },
  });
  assert.equal((await acsSmsEvents(request, context)).status, 400);
});

test("a single event outside an array is still handled", async () => {
  // Event Grid posts an array, but the portal's own test send does not.
  gatewayReturning({ changed: 1 });
  const response = await acsSmsEvents(eventRequest(smsEvent("+19523883275", "STOP")), context);
  assert.deepEqual((response.jsonBody as { stopped: number }).stopped, 1);
});

test("an empty batch is answered without pretending anything happened", async () => {
  const response: HttpResponseInit = await acsSmsEvents(eventRequest([]), context);
  assert.deepEqual(response.jsonBody, { received: 0, confirmed: 0, stopped: 0, failed: 0 });
});
