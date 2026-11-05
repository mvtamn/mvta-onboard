import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { oneClickUnsubscribe, setOneClickGatewayForTests } from "./subscribersOneClickUnsubscribe";

// The opt-out itself is optOut's, tested with the confirmation module. What
// is tested here is the shell: which ids reach the database, and that the
// answer never says whether one matched.

const context = { error: () => undefined, warn: () => undefined, log: () => undefined } as unknown as InvocationContext;
const DELIVERY = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

function recording(answer: boolean | Error) {
  const asked: string[] = [];
  setOneClickGatewayForTests({
    stop: async (id) => {
      asked.push(id);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  return asked;
}

function post(query: string): HttpRequest {
  return new HttpRequest({
    method: "POST",
    url: `https://example.test/api/subscribers/one-click-unsubscribe${query}`,
    body: { string: "List-Unsubscribe=One-Click" },
  });
}

afterEach(() => setOneClickGatewayForTests(null));

test("a delivery id stops that delivery's address", async () => {
  const asked = recording(true);
  const res = await oneClickUnsubscribe(post(`?d=${DELIVERY}`), context);
  assert.deepEqual(asked, [DELIVERY]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.jsonBody, { status: "ok" });
});

test("a matched id, an unmatched id and a failure all answer the same", async () => {
  const answers = [];
  for (const outcome of [true, false, new Error("db down")]) {
    recording(outcome);
    answers.push(await oneClickUnsubscribe(post(`?d=${DELIVERY}`), context));
  }
  for (const res of answers) assert.deepEqual(res, answers[0]);
});

test("anything that is not a UUID never reaches the database", async () => {
  const asked = recording(true);
  for (const query of ["", "?d=", "?d=abc", `?d=${DELIVERY}'--`, `?key=${DELIVERY}`]) {
    const res = await oneClickUnsubscribe(post(query), context);
    assert.equal(res.status, 200, query);
  }
  assert.deepEqual(asked, []);
});
