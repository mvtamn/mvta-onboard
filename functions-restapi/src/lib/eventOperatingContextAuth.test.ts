import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest } from "@azure/functions";
import { requireRole } from "./auth";
import { eventOperatingContextRoles } from "./eventOperatingContextAuth";

function requestFor(role: string, method: string) {
  const principal = Buffer.from(JSON.stringify({
    userId: "event-avl-reader",
    claims: [{ typ: "roles", val: role }],
  })).toString("base64");
  return new HttpRequest({ method, url: "https://example.test/api/events", headers: { "x-ms-client-principal": principal } });
}

test("Event AVL staff can read Event and operating-period choices but cannot change them", () => {
  assert.equal(requireRole(requestFor("OCC.EventAVL", "GET"), eventOperatingContextRoles("GET")).authorized, true);
  assert.deepEqual(requireRole(requestFor("OCC.EventAVL", "POST"), eventOperatingContextRoles("POST")), {
    authorized: false,
    status: 403,
    message: "Requires one of: OCC.Admin. Caller has: OCC.EventAVL.",
  });
});
