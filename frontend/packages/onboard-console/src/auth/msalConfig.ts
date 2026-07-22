import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

// MSAL configuration for the staff console. Authenticates against the existing
// MVTA OnBoard Entra ID app registration and requests an access token for the
// REST API scope. App roles (OCC.Viewer/Publisher/Admin, System.Ingestion)
// arrive as `roles` claims in the ID token and gate the UI.
//
// The PublicClientApplication is constructed LAZILY via getMsalInstance() so
// that merely importing this module (e.g. for `loginRequest`) never builds an
// MSAL client — important for the dev-only mock auth mode, where no Entra
// client ID is configured at all.
function buildConfig(): Configuration {
  return {
    auth: {
      clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
      redirectUri: window.location.origin + "/console/",
      postLogoutRedirectUri: window.location.origin + "/console/",
    },
    cache: {
      // sessionStorage keeps tokens out of long-lived localStorage; they clear
      // when the tab closes. Better default for a shared ops workstation.
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    },
  };
}

let instance: PublicClientApplication | null = null;

export function getMsalInstance(): PublicClientApplication {
  if (!instance) {
    instance = new PublicClientApplication(buildConfig());
  }
  return instance;
}

// Scope for calling the REST API (used by acquireTokenSilent / login).
export const apiScopes = [import.meta.env.VITE_API_SCOPE];

// Login also requests the API scope so the first token is API-callable.
export const loginRequest = { scopes: ["openid", "profile", ...apiScopes] };
