import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";

describe("authenticated API requests", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refreshes the token once when an authenticated GET receives 401", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const getToken = vi.fn(async (options?: { forceRefresh?: boolean }) => options?.forceRefresh ? "fresh-token" : "stale-token");
    const client = createApiClient({ baseUrl: "https://api.example.test", getToken });

    await expect(client.getEvents()).resolves.toEqual({ events: [] });
    expect(getToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).get("Authorization")).toBe("Bearer fresh-token");
  });
});
