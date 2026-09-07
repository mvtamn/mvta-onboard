import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@mvta/shared";
import { BrowserAuthError, InteractionRequiredAuthError } from "@azure/msal-browser";

// The bug this guards against, seen on dev 2026-09-06: silent token renewal
// failed, getToken returned null, and the request went out anyway with no
// Authorization header. Easy Auth attached no principal, every endpoint
// answered 401 "Not authenticated.", and the console reported it as a server
// fault. A token that cannot be obtained has to stop the request, not travel
// with it missing.
const acquireTokenSilent = vi.fn();
const acquireTokenRedirect = vi.fn(async () => undefined);
const account = { homeAccountId: "abc", username: "tyre@mvta.example" };

vi.mock("./auth/msalConfig.js", () => ({
  apiScopes: ["api://example/access_as_user"],
  getMsalInstance: () => ({
    getActiveAccount: () => account,
    getAllAccounts: () => [account],
    acquireTokenSilent,
    acquireTokenRedirect,
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => { vi.clearAllMocks(); });

async function callAuthenticatedEndpoint() {
  const { api } = await import("./config.js");
  return api.getDecisionMatrixGovernanceQueue();
}

describe("API token acquisition", () => {
  it("sends the token when silent renewal works", async () => {
    acquireTokenSilent.mockResolvedValue({ accessToken: "good-token" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ procedures: [], diagnostics: { table_ready: true, required_migration: "076" } }), { status: 200, headers: { "content-type": "application/json" } }));
    await callAuthenticatedEndpoint();
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer good-token");
  });

  it("refuses to send a request that lost its identity, rather than letting the API call it a 401", async () => {
    acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("interaction_required", "consent needed"));
    await expect(callAuthenticatedEndpoint()).rejects.toBeInstanceOf(ApiError);
    await expect(callAuthenticatedEndpoint()).rejects.toMatchObject({ status: 401 });
    // The request never left: an anonymous call is what produced the
    // indistinguishable-from-an-outage 401 in the first place.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects to sign in when interaction is required", async () => {
    acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("interaction_required", "consent needed"));
    await callAuthenticatedEndpoint().catch(() => undefined);
    expect(acquireTokenRedirect).toHaveBeenCalled();
  });

  it("also redirects when the hidden-iframe renewal is blocked, which is not an InteractionRequiredAuthError", async () => {
    // Browsers blocking third-party cookies fail silent renewal this way. It
    // used to fall straight through to null with no redirect at all.
    acquireTokenSilent.mockRejectedValue(new BrowserAuthError("monitor_window_timeout", "iframe timed out"));
    await callAuthenticatedEndpoint().catch(() => undefined);
    expect(acquireTokenRedirect).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a sign-in failure that no redirect can fix, instead of going out anonymous", async () => {
    acquireTokenSilent.mockRejectedValue(new Error("network went away"));
    await expect(callAuthenticatedEndpoint()).rejects.toMatchObject({ status: 401 });
    expect(acquireTokenRedirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
