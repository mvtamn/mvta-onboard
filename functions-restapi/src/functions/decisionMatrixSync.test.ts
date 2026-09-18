import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { HttpRequest, type InvocationContext } from "@azure/functions";
import { retiredDecisionMatrixSync } from "./decisionMatrixSync";
import { useAccessExecutorForTests } from "../lib/access";
import { fakeAccessDb } from "../lib/access/testSupport";

// Since the cutover an app role in a token grants nobody anything, so a case
// states what its caller holds as a Role Grant, the way production reads it.
function holding(...roleKeys: string[]) {
  useAccessExecutorForTests(fakeAccessDb(roleKeys.map((roleKey) => ({ objectId: "*", roleKey }))));
}

afterEach(() => useAccessExecutorForTests(null));

function adminRequest(): HttpRequest {
  const principal = Buffer.from(JSON.stringify({
    userId: "admin-1",
    userDetails: "admin@mvta.com",
  })).toString("base64");
  return new HttpRequest({
    method: "POST",
    url: "https://example.test/api/manage/decision-matrix/sync",
    headers: { "x-ms-client-principal": principal },
  });
}

test("retired SharePoint import returns a diagnostic without reading or changing Decision Matrix content", async () => {
  holding("system-administrator");
  const audit: unknown[][] = [];
  const context = { warn: (...args: unknown[]) => audit.push(args) } as unknown as InvocationContext;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = (async () => {
    fetchCalls++;
    throw new Error("SharePoint must not be contacted by a retired import");
  }) as typeof fetch;

  try {
    const response = await retiredDecisionMatrixSync(adminRequest(), context);

    assert.equal(response.status, 410);
    assert.deepEqual(response.jsonBody, {
      error: "SharePoint structured-content import is retired. Decision Matrix content is authored in OnBoard; SharePoint stores supporting documents only.",
      code: "decision_matrix_import_retired",
    });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(audit, [["Retired Decision Matrix SharePoint import attempted", {
      route: "manage/decision-matrix/sync",
      actor: "admin@mvta.com",
    }]]);
  } finally {
    global.fetch = originalFetch;
  }
});
