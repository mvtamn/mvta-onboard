// Typed API client for the MVTA OnBoard REST API.
//
// The base URL is injected at build time (Vite env) rather than hardcoded -
// the old demo_service_alerts.html baked the Front Door hostname into source,
// which meant editing source whenever the endpoint changed. Each app passes
// its own base URL and, for the staff console, a token provider so calls to
// write endpoints carry an Entra bearer token.

import type {
  ActiveMessage,
  AdminMessage,
  CreateMessageInput,
  CreateMessageResult,
  ExpirationDefault,
  MaskedSubscriber,
  SubscribeInput,
  SubscribersSummary,
  SuggestedAlert,
  SuggestedAlertStatus,
} from "./types.js";

export type TokenProvider = () => Promise<string | null>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Optional: returns an access token for authenticated (write) calls. */
  getToken?: TokenProvider;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init: RequestInit = {},
    authenticated = false,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated && getToken) {
      const token = await getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const res = await fetch(`${root}${path}`, { ...init, headers });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      const message =
        (payload && (payload.error as string)) || `Request failed (${res.status})`;
      throw new ApiError(res.status, message, payload?.details);
    }
    return payload as T;
  }

  return {
    // Public read - no auth.
    getActiveMessages(filters?: { channel?: string; route?: string; zone?: string }) {
      const qs = new URLSearchParams();
      if (filters?.channel) qs.set("channel", filters.channel);
      if (filters?.route) qs.set("route", filters.route);
      if (filters?.zone) qs.set("zone", filters.zone);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ messages: ActiveMessage[] }>(`/api/messages/active${suffix}`);
    },

    // Staff write - requires an Entra token (OCC.Publisher / OCC.Admin).
    createMessage(input: CreateMessageInput) {
      return request<CreateMessageResult>(
        "/api/messages",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    // Public rider opt-in. Server enforces double opt-in confirmation.
    subscribe(input: SubscribeInput) {
      return request<{ subscriber_id: string; status: string }>(
        "/api/subscribers",
        { method: "POST", body: JSON.stringify(input) },
      );
    },

    // --- Staff console (all authenticated; server enforces roles) ---

    updateMessage(id: string, input: { summary?: string; expires_at?: string }) {
      return request<{ message_id: string; summary: string | null; expires_at: string }>(
        `/api/messages/${id}`,
        { method: "PATCH", body: JSON.stringify(input) },
        true,
      );
    },

    retractMessage(id: string) {
      return request<{ message_id: string; status: string }>(
        `/api/messages/${id}/retract`,
        { method: "POST" },
        true,
      );
    },

    searchAdminMessages(filters?: { tag?: string; q?: string; limit?: number }) {
      const qs = new URLSearchParams();
      if (filters?.tag) qs.set("tag", filters.tag);
      if (filters?.q) qs.set("q", filters.q);
      if (filters?.limit) qs.set("limit", String(filters.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ messages: AdminMessage[] }>(`/api/admin/messages${suffix}`, {}, true);
    },

    getExpirationDefaults() {
      return request<{ defaults: ExpirationDefault[] }>("/api/admin/expiration-defaults", {}, true);
    },

    updateExpirationDefault(category: string, default_ttl_minutes: number) {
      return request<ExpirationDefault>(
        `/api/admin/expiration-defaults/${category}`,
        { method: "PATCH", body: JSON.stringify({ default_ttl_minutes }) },
        true,
      );
    },

    getSubscribersSummary() {
      return request<{ summary: SubscribersSummary; recent?: MaskedSubscriber[] }>(
        "/api/admin/subscribers/summary",
        {},
        true,
      );
    },

    getSuggestedAlerts(status: SuggestedAlertStatus | "all" = "pending") {
      return request<{ alerts: SuggestedAlert[] }>(`/api/suggested-alerts?status=${status}`, {}, true);
    },

    approveSuggestedAlert(id: string) {
      return request<{ alert_id: string; status: string; message_id: string }>(
        `/api/suggested-alerts/${id}/approve`,
        { method: "POST" },
        true,
      );
    },

    dismissSuggestedAlert(id: string) {
      return request<{ alert_id: string; status: string }>(
        `/api/suggested-alerts/${id}/dismiss`,
        { method: "POST" },
        true,
      );
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
