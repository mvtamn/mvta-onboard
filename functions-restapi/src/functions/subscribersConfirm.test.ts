import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import type { ConfirmOutcome, ConfirmResult, ResendResult } from "../lib/subscriberConfirmation";
import type { ConfirmationRequestedEvent } from "../lib/types";
import {
  confirmEmailLink,
  confirmSmsCode,
  confirmedUrl,
  emailStatus,
  resendConfirmationRequest,
  setConfirmGatewayForTests,
  smsStatus,
} from "./subscribersConfirm";

// The state machine has its own tests (lib/subscriberConfirmation.test.ts) and
// its own contract tests. What is tested here is the HTTP shell's own
// decisions, and nearly all of them are about what an anonymous caller is
// allowed to LEARN. Those are not visible to a test of the module underneath,
// because the module deliberately returns more than the endpoint says.

const context = { error: () => undefined, warn: () => undefined, log: () => undefined } as unknown as InvocationContext;

/**
 * A gateway that answers with a fixed result and records what was published.
 *
 * `withTransaction` ignores its callback rather than running it: the callback
 * is the lib function, which has its own tests, and standing in for its answer
 * is what lets every outcome be reached here without a database.
 */
function gatewayReturning(result: unknown) {
  const published: ConfirmationRequestedEvent[] = [];
  setConfirmGatewayForTests({
    withTransaction: async () => result as never,
    publish: async (event) => {
      published.push(event);
      return true;
    },
  });
  return published;
}

function gatewayThrowing(error: Error) {
  setConfirmGatewayForTests({
    withTransaction: async () => {
      throw error;
    },
    publish: async () => true,
  });
}

afterEach(() => setConfirmGatewayForTests(null));

function emailRequest(query: string): HttpRequest {
  return new HttpRequest({ method: "GET", url: `https://example.test/api/subscribers/confirm-email${query}` });
}

function postRequest(route: string, body: unknown): HttpRequest {
  return new HttpRequest({
    method: "POST",
    url: `https://example.test/api/subscribers/${route}`,
    headers: { "content-type": "application/json" },
    body: { string: JSON.stringify(body) },
  });
}

/** One header off a response the handlers build as a plain object. */
function headerOf(response: HttpResponseInit, name: string): string {
  return (response.headers as Record<string, string>)[name];
}

const locationOf = (response: HttpResponseInit) => headerOf(response, "Location");

// --- what the email link says -----------------------------------------------

test("every outcome the email link can reach has something to tell the rider", () => {
  // The link IS proof of the address, so nothing here has to be withheld;
  // every one of these has a different remedy on the landing page.
  assert.equal(emailStatus("confirmed"), "confirmed");
  assert.equal(emailStatus("already_confirmed"), "already_confirmed");
  assert.equal(emailStatus("superseded"), "superseded");
  assert.equal(emailStatus("expired"), "expired");
  assert.equal(emailStatus("opted_out"), "opted_out");
  assert.equal(emailStatus("not_found"), "invalid");
});

test("the redirect never carries the token", async () => {
  gatewayReturning({ outcome: "confirmed", subscriberId: "sub-1", channel: "email" } satisfies ConfirmResult);
  const response = await confirmEmailLink(emailRequest("?token=super-secret-token"), context);
  assert.equal(response.status, 302);
  assert.ok(!locationOf(response).includes("super-secret-token"));
  assert.match(locationOf(response), /status=confirmed/);
});

test("a request with no token is a dead link, not a 400", async () => {
  // The caller is a browser the rider is looking at. A JSON error body is not
  // an answer to a person.
  const response = await confirmEmailLink(emailRequest(""), context);
  assert.equal(response.status, 302);
  assert.match(locationOf(response), /status=invalid/);
});

test("a database failure still lands the rider on a page that can help", async () => {
  gatewayThrowing(new Error("pool exhausted"));
  const response = await confirmEmailLink(emailRequest("?token=t"), context);
  assert.equal(response.status, 302);
  assert.match(locationOf(response), /status=invalid/);
});

test("the outcome of one rider's token is never cached", async () => {
  gatewayReturning({ outcome: "confirmed" } satisfies ConfirmResult);
  const response = await confirmEmailLink(emailRequest("?token=t"), context);
  assert.equal(headerOf(response, "Cache-Control"), "no-store");
});

test("an unset RIDER_APP_BASE_URL redirects within the host rather than nowhere", () => {
  assert.equal(confirmedUrl(undefined, "confirmed", "email"), "/subscribe/confirmed?status=confirmed&channel=email");
  assert.equal(confirmedUrl("", "expired", "email"), "/subscribe/confirmed?status=expired&channel=email");
});

test("a base URL with a trailing slash does not produce a doubled one", () => {
  assert.equal(
    confirmedUrl("https://rider.example/", "confirmed", "sms"),
    "https://rider.example/subscribe/confirmed?status=confirmed&channel=sms",
  );
});

// --- what the SMS endpoint refuses to say ------------------------------------

test("confirm-sms tells an arbitrary caller nothing but success", () => {
  // Each of these would otherwise answer, for any number typed into it,
  // whether that number is subscribed or mid-signup.
  const refusals: ConfirmOutcome[] = [
    "not_found",
    "incorrect_code",
    "too_many_attempts",
    "expired",
    "superseded",
    "opted_out",
    "already_confirmed",
  ];
  for (const outcome of refusals) assert.equal(smsStatus(outcome), "invalid", outcome);
  assert.equal(smsStatus("confirmed"), "confirmed");
});

test("a correct code confirms", async () => {
  gatewayReturning({ outcome: "confirmed", subscriberId: "sub-1", channel: "sms" } satisfies ConfirmResult);
  const response = await confirmSmsCode(postRequest("confirm-sms", { phone_number: "612-555-0123", code: "123456" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: "confirmed", channel: "sms" });
});

/** Whether the handler got as far as opening a transaction. */
function gatewayCountingQueries(result: unknown) {
  const state = { queried: false };
  setConfirmGatewayForTests({
    withTransaction: async () => {
      state.queried = true;
      return result as never;
    },
    publish: async () => true,
  });
  return state;
}

test("a number typed the way a rider writes it is still looked up", async () => {
  // Stored E.164. A "(612) 555-0123" that reached the query unchanged would
  // match nothing, and read to the rider as never having subscribed.
  const state = gatewayCountingQueries({ outcome: "confirmed" } satisfies ConfirmResult);
  const response = await confirmSmsCode(postRequest("confirm-sms", { phone_number: "(612) 555-0123", code: "123456" }), context);
  assert.equal(state.queried, true);
  assert.deepEqual(response.jsonBody, { status: "confirmed", channel: "sms" });
});

test("an unusable number or code is answered without a query, in the same shape as a wrong code", async () => {
  const state = gatewayCountingQueries({ outcome: "confirmed" } satisfies ConfirmResult);
  for (const body of [
    { phone_number: "612555012", code: "123456" },
    { phone_number: "+16125550123", code: "12345" },
    { phone_number: "+16125550123", code: "abcdef" },
  ]) {
    const response = await confirmSmsCode(postRequest("confirm-sms", body), context);
    assert.deepEqual(response.jsonBody, { status: "invalid" }, JSON.stringify(body));
  }
  assert.equal(state.queried, false, "nothing that cannot match should reach the database");
});

test("a body missing either field is the caller's error, and says so", async () => {
  const response = await confirmSmsCode(postRequest("confirm-sms", { phone_number: "+16125550123" }), context);
  assert.equal(response.status, 400);
});

// --- resend -------------------------------------------------------------------

test("resend answers identically whatever the database found", async () => {
  for (const result of [
    { outcome: "issued", subscriberId: "sub-1", issued: { confirmation_id: "c1", channel: "sms", token: "654321" } },
    { outcome: "too_soon", subscriberId: "sub-1" },
    { outcome: "nothing_to_send" },
  ] as ResendResult[]) {
    gatewayReturning(result);
    const response = await resendConfirmationRequest(postRequest("resend", { phone_number: "+16125550123" }), context);
    assert.equal(response.status, 200, result.outcome);
    assert.deepEqual(response.jsonBody, { status: "ok" }, result.outcome);
  }
});

test("an empty body is answered the same way, so 'you gave me nothing' is not a distinguishable reply", async () => {
  const response = await resendConfirmationRequest(postRequest("resend", {}), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: "ok" });
});

test("an internal failure is still answered ok", async () => {
  // An error that only appears for contacts that exist is the membership
  // oracle the uniform answer exists to close.
  gatewayThrowing(new Error("deadlock"));
  const response = await resendConfirmationRequest(postRequest("resend", { email: "rider@example.com" }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, { status: "ok" });
});

test("only an issued token is published, and it carries the contact it was issued for", async () => {
  const published = gatewayReturning({
    outcome: "issued",
    subscriberId: "sub-1",
    issued: { confirmation_id: "c1", channel: "sms", token: "654321" },
  } satisfies ResendResult);
  await resendConfirmationRequest(postRequest("resend", { phone_number: "612-555-0123" }), context);
  assert.deepEqual(published, [
    {
      confirmation_id: "c1",
      subscriber_id: "sub-1",
      channel: "sms",
      token: "654321",
      phone_number: "+16125550123",
      email: null,
    },
  ]);
});

test("a cooled-down resend sends nothing", async () => {
  const published = gatewayReturning({ outcome: "too_soon", subscriberId: "sub-1" } satisfies ResendResult);
  await resendConfirmationRequest(postRequest("resend", { phone_number: "+16125550123" }), context);
  assert.deepEqual(published, []);
});
