import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { setSubscribeOptionsGatewayForTests, subscribeOptionsHandler } from "./subscribersOptions";

// readOptions itself is exercised by the preference contract tests. What is
// tested here is the anonymous shell: it answers with the lists, and a failure
// says nothing about why.

const errors: unknown[][] = [];
const context = {
  error: (...args: unknown[]) => errors.push(args),
  warn: () => undefined,
  log: () => undefined,
} as unknown as InvocationContext;

const request = () => new HttpRequest({ url: "https://example.test/api/subscribers/options", method: "GET" });

afterEach(() => {
  setSubscribeOptionsGatewayForTests(null);
  errors.length = 0;
});

test("answers with the routes and zones a rider may choose from", async () => {
  const options = { routes: [{ id: "470", label: "470 - Burnsville - Minneapolis" }], zones: [] };
  setSubscribeOptionsGatewayForTests({ read: async () => options });
  const response = await subscribeOptionsHandler(request(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(response.jsonBody, options);
  assert.match(String((response.headers as Record<string, string>)["Cache-Control"]), /max-age=300/);
});

test("a failed read is a plain 500 that does not say why", async () => {
  setSubscribeOptionsGatewayForTests({
    read: async () => {
      throw new Error("Login failed for user 'reader'");
    },
  });
  const response = await subscribeOptionsHandler(request(), context);
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(response.jsonBody), /login|reader/i);
  assert.equal(errors.length, 1);
});
