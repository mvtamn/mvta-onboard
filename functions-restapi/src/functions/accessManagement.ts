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

app.http("accessManagement", {
  // Azure Functions v4 does not reliably dispatch the catch-all form
  // `{*operation}` for Node HTTP triggers. All supported Access Management
  // operations fit within these three optional path segments.
  route: "admin/access-management/{operation?}/{id?}/{action?}",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
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
  },
});
