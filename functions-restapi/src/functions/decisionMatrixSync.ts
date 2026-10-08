import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { requireAccess } from "../lib/access/require";

const RETIRED_IMPORT_MESSAGE = "SharePoint structured-content import is retired. Decision Matrix content is authored in OnBoard; SharePoint stores supporting documents only.";

export async function retiredDecisionMatrixSync(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const auth = await requireAccess(request, "decision-matrix.manage");
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

  context.warn("Retired Decision Matrix SharePoint import attempted", {
    route: "manage/decision-matrix/sync",
    actor: auth.principal.userDetails ?? auth.principal.userId ?? "unknown",
  });
  return {
    status: 410,
    jsonBody: {
      error: RETIRED_IMPORT_MESSAGE,
      code: "decision_matrix_import_retired",
    },
  };
}

app.http("decisionMatrixSync", {
  route: "manage/decision-matrix/sync",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: retiredDecisionMatrixSync,
});
