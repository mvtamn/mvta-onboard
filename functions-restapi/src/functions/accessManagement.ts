import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { OnBehalfOfCredential } from "@azure/identity";
import { createAccessManagementHttpHandler } from "../lib/accessManagementHttp";
import { GraphAccessDirectory, GraphAccessError, type AccessEnvironmentConfig } from "../lib/accessManagementGraph";
import { AccessManagementStateConflictError, SqlAccessManagementStore } from "../lib/accessManagementStore";

let productionHandler: ReturnType<typeof createAccessManagementHttpHandler> | null = null;

function requiredSetting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Access Management.`);
  return value;
}

function accessEnvironmentConfig(): AccessEnvironmentConfig {
  const raw = requiredSetting("ONBOARD_ACCESS_CONFIG_JSON");
  const parsed = JSON.parse(raw) as AccessEnvironmentConfig | { environments?: AccessEnvironmentConfig[] };
  const environment = process.env.ONBOARD_ENVIRONMENT?.trim() || "development";
  const bundle = parsed as { environments?: AccessEnvironmentConfig[] };
  const config: AccessEnvironmentConfig | undefined = Array.isArray(bundle.environments)
    ? bundle.environments.find((candidate) => candidate.environment === environment)
    : parsed as AccessEnvironmentConfig;
  if (!config || config.environment !== environment || !config.application_id || !config.service_principal_id) {
    throw new Error(`ONBOARD_ACCESS_CONFIG_JSON does not contain a valid ${environment} configuration.`);
  }
  return config;
}

function getProductionHandler() {
  if (productionHandler) return productionHandler;
  const config = accessEnvironmentConfig();
  const tenantId = requiredSetting("AZURE_TENANT_ID");
  const clientId = requiredSetting("ONBOARD_API_CLIENT_ID");
  const clientSecret = requiredSetting("ONBOARD_API_CLIENT_SECRET");
  const directory = new GraphAccessDirectory(config, async (userAssertionToken) => {
    const credential = new OnBehalfOfCredential({ tenantId, clientId, clientSecret, userAssertionToken });
    const token = await credential.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph delegated token acquisition returned no token.");
    return token.token;
  });
  productionHandler = createAccessManagementHttpHandler({
    directory,
    store: new SqlAccessManagementStore(),
    environment: config.environment,
    allowAdminFallback: process.env.ONBOARD_ACCESS_ADMIN_FALLBACK === "true",
    privilegedAuthContext: process.env.ONBOARD_PRIVILEGED_AUTH_CONTEXT?.trim() || "c1",
  });
  return productionHandler;
}

const accessManagementHandler = async (request: HttpRequest, context: InvocationContext) => {
    try {
      return await getProductionHandler()(request);
    } catch (error) {
      context.error(`${request.method} ${request.url} failed:`, error);
      if (error instanceof AccessManagementStateConflictError) {
        return { status: 409, jsonBody: { error: error.message } };
      }
      if (error instanceof GraphAccessError) {
        if (error.status === 429) {
          return {
            status: 429,
            headers: error.retry_after_seconds === null ? undefined : { "Retry-After": String(error.retry_after_seconds) },
            jsonBody: { error: "Microsoft Entra is throttling Access Management. Retry later." },
          };
        }
        return { status: error.status === 401 || error.status === 403 ? 503 : 502, jsonBody: { error: "Microsoft Entra could not complete the Access Management request." } };
      }
      return { status: 500, jsonBody: { error: "Access Management is unavailable." } };
    }
};

// Use ordinary Functions routes rather than a catch-all. The Node v4 host on
// this App Service plan registers catch-all routes but does not dispatch them.
const accessManagementRoutes = [
  ["accessManagementPrincipals", "access-management/principals", ["GET"]],
  ["accessManagementDirectorySearch", "access-management/directory/search", ["GET"]],
  ["accessManagementChanges", "access-management/changes", ["GET", "POST"]],
  ["accessManagementPreview", "access-management/changes/preview", ["POST"]],
  ["accessManagementDecision", "access-management/changes/{id}/decision", ["POST"]],
  ["accessManagementCancellation", "access-management/changes/{id}/cancel", ["POST"]],
  ["accessManagementSignIns", "access-management/principals/{id}/sign-ins", ["GET"]],
  ["accessManagementAudit", "access-management/audit", ["GET"]],
  ["accessManagementExpirations", "access-management/expirations", ["GET"]],
  ["accessManagementApplyExpirations", "access-management/expirations/apply", ["POST"]],
  ["accessManagementReconciliation", "access-management/reconciliation", ["GET"]],
  ["accessManagementExport", "access-management/export", ["POST"]],
] as const;

for (const [name, route, methods] of accessManagementRoutes) {
  app.http(name, { route, methods: [...methods], authLevel: "anonymous", handler: accessManagementHandler });
}
