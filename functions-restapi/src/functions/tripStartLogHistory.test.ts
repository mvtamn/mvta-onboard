import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { getTripStartVerificationHistory } from "./tripStartLogHistory";

const context = { error: () => undefined, log: () => undefined } as unknown as InvocationContext;

function request(query: string, roles: string[]): HttpRequest {
  const principal = Buffer.from(JSON.stringify({ claims: roles.map((val) => ({ typ: "roles", val })) })).toString("base64");
  return new HttpRequest({
    method: "GET",
    url: `https://example.test/api/trip-start-log/history${query}`,
    headers: { "x-ms-client-principal": principal },
  });
}

test("reading a trip's history needs no more than reading the log itself", async () => {
  const outsider = await getTripStartVerificationHistory(request("?date=20260908&trip_id=t1", ["Rider.Subscriber"]), context);
  assert.equal(outsider.status, 403);
});

test("a history request names one trip on one service date", async () => {
  const noTrip = await getTripStartVerificationHistory(request("?date=20260908", ["OCC.Viewer"]), context);
  assert.equal(noTrip.status, 400);
  const badDate = await getTripStartVerificationHistory(request("?date=Sept&trip_id=t1", ["OCC.Viewer"]), context);
  assert.equal(badDate.status, 400);
});
