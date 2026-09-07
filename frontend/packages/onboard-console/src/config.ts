import { ApiError, createApiClient, type TokenRequestOptions } from "@mvta/shared";
import { BrowserAuthError, InteractionRequiredAuthError } from "@azure/msal-browser";

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
    const result = await msalInstance.acquireTokenSilent({ scopes: apiScopes, account, claims, forceRefresh: options?.forceRefresh });
    return result.accessToken;
  } catch (err) {
    // Returning null here used to be silent, and it was the worst possible
    // answer. Without a token the request still goes out - just with no
    // Authorization header - so Easy Auth attaches no x-ms-client-principal and
    // every endpoint answers 401 "Not authenticated." The console then reported
    // whatever its module says when a call fails, which across the app reads as
    // a server fault. On 2026-09-06 that showed up as four Decision Matrix
    // panels blaming the database, roughly an hour after a working session.
    //
    // Only InteractionRequiredAuthError triggered a redirect, and that is the
    // narrower half of the problem: silent renewal runs in a hidden iframe, so
    // a browser blocking third-party cookies fails it with a BrowserAuthError
    // instead, which fell straight through to null. Redirect for both, since
    // both mean "silent renewal cannot work here".
    if (err instanceof InteractionRequiredAuthError || err instanceof BrowserAuthError) {
      // If the redirect itself fails there is nothing further to try; the throw
      // below still tells the user what happened.
      await msalInstance.acquireTokenRedirect({ scopes: apiScopes, account, claims }).catch(() => undefined);
    }
    // Anything else - a network blip, a revoked refresh token - is still a
    // sign-in that cannot be used. Say so, rather than letting the request go
    // out unauthenticated and be reported as somebody else's outage.
    throw new ApiError(401, "Your OnBoard sign-in has expired. Reload the page to sign in again.");
  }
}

export const api = createApiClient({ baseUrl, getToken, privilegedAuthenticationContext });
