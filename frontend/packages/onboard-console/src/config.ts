import { createApiClient, type TokenRequestOptions } from "@mvta/shared";
import { InteractionRequiredAuthError } from "@azure/msal-browser";

const baseUrl = import.meta.env.VITE_API_BASE ?? "";
const privilegedAuthenticationContext = import.meta.env.VITE_PRIVILEGED_AUTH_CONTEXT || "c1";

// Token provider for authenticated API calls: silent acquisition, falling back
// to a redirect when consent/interaction is required. In dev mock-auth mode
// there is no MSAL at all — return null (writes then surface the API's own
// 401, which is honest preview behavior: the server always enforces roles).
async function getToken(options?: TokenRequestOptions): Promise<string | null> {
  if (import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === "mock") {
    return null;
  }
  const { getMsalInstance, apiScopes } = await import("./auth/msalConfig.js");
  const msalInstance = getMsalInstance();
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) return null;
  const claims = options?.authenticationContext
    ? JSON.stringify({ access_token: { acrs: { essential: true, value: options.authenticationContext } } })
    : undefined;
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: apiScopes, account, claims });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect({ scopes: apiScopes, account, claims });
    }
    return null;
  }
}

export const api = createApiClient({ baseUrl, getToken, privilegedAuthenticationContext });
