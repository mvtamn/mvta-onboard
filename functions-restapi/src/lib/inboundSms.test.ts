import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInboundSms,
  parseInboundSms,
  validationResponse,
  SMS_RECEIVED_EVENT,
  SUBSCRIPTION_VALIDATION_EVENT,
} from "./inboundSms";

test("the Event Grid handshake is answered with the code it sent", () => {
  // Until this is echoed the subscription does not exist, so every other test
  // here is about events that would never arrive.
  assert.deepEqual(
    validationResponse([{ eventType: SUBSCRIPTION_VALIDATION_EVENT, data: { validationCode: "abc-123" } }]),
    { validationResponse: "abc-123" },
  );
  assert.equal(validationResponse([{ eventType: SMS_RECEIVED_EVENT, data: {} }]), null);
  assert.equal(validationResponse([{ eventType: SUBSCRIPTION_VALIDATION_EVENT, data: {} }]), null);
});

test("an inbound message is read out of the event", () => {
  const parsed = parseInboundSms([
    {
      eventType: SMS_RECEIVED_EVENT,
      data: {
        from: "+16125550123",
        to: "+18005550000",
        message: "123456",
        receivedTimestamp: "2026-09-12T02:00:00Z",
      },
    },
  ]);
  assert.deepEqual(parsed, [
    { from: "+16125550123", to: "+18005550000", message: "123456", receivedAt: "2026-09-12T02:00:00Z" },
  ]);
});

test("events that are not inbound texts are ignored, not guessed at", () => {
  assert.deepEqual(parseInboundSms([{ eventType: "Microsoft.Communication.SMSDeliveryReportReceived", data: { from: "+1", message: "x" } }]), []);
  assert.deepEqual(parseInboundSms([{ eventType: SMS_RECEIVED_EVENT }]), []);
});

test("a message with no sender is dropped", () => {
  // Every action is scoped to the number that sent it, and that scoping is
  // what stops a texted code confirming somebody else's subscription. With no
  // sender there is nothing safe to do.
  assert.deepEqual(parseInboundSms([{ eventType: SMS_RECEIVED_EVENT, data: { message: "STOP", to: "+18005550000" } }]), []);
});

test("an empty message is kept, because it is still a message that arrived", () => {
  // Distinct from a missing one: the rider sent something, it classifies as
  // "other", and it is logged rather than discarded before anyone sees it.
  const parsed = parseInboundSms([{ eventType: SMS_RECEIVED_EVENT, data: { from: "+16125550123", message: "" } }]);
  assert.equal(parsed.length, 1);
  assert.deepEqual(classifyInboundSms(parsed[0].message), { kind: "other" });
});

test("a batch is processed in full, not just its first event", () => {
  const parsed = parseInboundSms([
    { eventType: SUBSCRIPTION_VALIDATION_EVENT, data: { validationCode: "x" } },
    { eventType: SMS_RECEIVED_EVENT, data: { from: "+16125550123", message: "STOP" } },
    { eventType: SMS_RECEIVED_EVENT, data: { from: "+16125550142", message: "123456" } },
  ]);
  assert.deepEqual(parsed.map((m) => m.message), ["STOP", "123456"]);
});

test("the stop keywords are matched exactly, whatever the casing or spacing", () => {
  for (const text of ["STOP", "stop", " Stop ", "UNSUBSCRIBE", "cancel", "End", "quit", "stopall"]) {
    assert.deepEqual(classifyInboundSms(text), { kind: "stop" }, text);
  }
});

test("a sentence containing a stop word is not a stop", () => {
  // Widening the match is how a rider asking a question gets silently
  // unsubscribed - and it would make OnBoard disagree with the carrier opt-out
  // database that actually governs delivery.
  for (const text of ["Stop please", "please stop the 444 alerts", "stop sending texts after 9pm", "STOP?"]) {
    assert.deepEqual(classifyInboundSms(text), { kind: "other" }, text);
  }
});

test("six digits and nothing else is a code", () => {
  assert.deepEqual(classifyInboundSms("123456"), { kind: "code", code: "123456" });
  assert.deepEqual(classifyInboundSms("  654321 "), { kind: "code", code: "654321" });
  assert.deepEqual(classifyInboundSms("000000"), { kind: "code", code: "000000" });
});

test("digits inside a message are not pulled out as a code", () => {
  // Doing so would spend one of the rider's five attempts on something that
  // may never have been a code, and the attempt cap is what makes six digits
  // worth anything.
  for (const text of ["my code is 123456", "route 123456", "12345", "1234567", "123 456"]) {
    assert.deepEqual(classifyInboundSms(text), { kind: "other" }, text);
  }
});

test("HELP and START are left to the carrier, not answered here", () => {
  // ACS answers HELP from the campaign brief; a second answer would be a
  // duplicate text. START means resuming delivery, which OnBoard cannot honour
  // on its own because resubscribing means recording consent.
  for (const text of ["HELP", "help", "START", "UNSTOP"]) {
    assert.deepEqual(classifyInboundSms(text), { kind: "other" }, text);
  }
});
