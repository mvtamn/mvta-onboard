import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { clearAccessCache } from "./access";
import { requireAccess } from "./access/require";
import { eventOperatingContextAction } from "./eventOperatingContextAuth";

function requestFor(role: string, method: string) {
  const principal = Buffer.from(JSON.stringify({
    userId: "event-avl-reader",
    claims: [{ typ: "roles", val: role }],
  })).toString("base64");
  return new HttpRequest({ method, url: "https://example.test/api/events", headers: { "x-ms-client-principal": principal } });
}

test("Event AVL staff can read Event and operating-period choices but cannot change them", async () => {
  clearAccessCache();
  const read = await requireAccess(requestFor("OCC.EventAVL", "GET"), eventOperatingContextAction("GET"));
  assert.equal(read.authorized, true);

  clearAccessCache();
  const write = await requireAccess(requestFor("OCC.EventAVL", "POST"), eventOperatingContextAction("POST"));
  assert.equal(write.authorized, false);
  assert.equal(write.authorized === false ? write.status : 0, 403);
});
