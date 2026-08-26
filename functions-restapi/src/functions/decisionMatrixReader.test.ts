import assert from "node:assert/strict";
import test from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { isInlineImageMime, listDecisionMatrix } from "./decisionMatrix";

const context = { error: () => undefined } as unknown as InvocationContext;

test("the approved Procedure reader requires a staff role", async () => {
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/decision-matrix" });
  const response = await listDecisionMatrix(request, context);
  assert.equal(response.status, 401);
});

test("Event AVL alone cannot read the Decision Matrix", async () => {
  const principal = Buffer.from(JSON.stringify({ claims: [{ typ: "roles", val: "OCC.EventAVL" }] })).toString("base64");
  const request = new HttpRequest({ method: "GET", url: "https://example.test/api/decision-matrix", headers: { "x-ms-client-principal": principal } });
  const response = await listDecisionMatrix(request, context);
  assert.equal(response.status, 403);
});

test("only PNG and JPEG renditions are eligible for same-origin inline preview", () => {
  assert.equal(isInlineImageMime("image/png"), true);
  assert.equal(isInlineImageMime("image/jpeg"), true);
  assert.equal(isInlineImageMime("application/pdf"), false);
  assert.equal(isInlineImageMime("text/html"), false);
});
