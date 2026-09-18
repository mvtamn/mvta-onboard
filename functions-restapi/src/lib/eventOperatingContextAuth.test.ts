import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { clearAccessCache } from "./access";
import { requireAccess } from "./access/require";
import { fakeAccessDb } from "./access/testSupport";
import { eventOperatingContextAction } from "./eventOperatingContextAuth";

function requestFor(method: string) {
  const principal = Buffer.from(JSON.stringify({
    userId: "event-avl-reader",
    claims: [{ typ: "oid", val: "event-avl-reader" }],
  })).toString("base64");
  return new HttpRequest({ method, url: "https://example.test/api/events", headers: { "x-ms-client-principal": principal } });
}

const operator = { executor: fakeAccessDb([{ objectId: "event-avl-reader", roleKey: "event-avl-operator" }]) };

test("an Event AVL Operator can read Event and operating-period choices but cannot change them", async () => {
  clearAccessCache();
  const read = await requireAccess(requestFor("GET"), eventOperatingContextAction("GET"), operator);
  assert.equal(read.authorized, true);

  clearAccessCache();
  const write = await requireAccess(requestFor("POST"), eventOperatingContextAction("POST"), operator);
  assert.equal(write.authorized, false);
  assert.equal(write.authorized === false ? write.status : 0, 403);
});
