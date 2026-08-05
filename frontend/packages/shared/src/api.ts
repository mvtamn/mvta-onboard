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
  PrepareSuggestedAlertInput,
  PrepareSuggestedAlertResult,
  TripDelay,
  TripDelayDiagnostics,
  OnDemandRiskRecord,
  MissedTrip,
  ValidateMissedTripInput,
  GtfsRouteOption,
  Category,
  Severity,
  AvailAvlVehicle,
  FixedRouteDeparture,
  OtpMonthlyStopRow,
  OtpMonthlyRouteRollup,
  AvailMissedTripRecord,
  AvailMissedTripsRouteRollup,
  Detour,
  DetourStatus,
  CreateDetourInput,
  UpdateDetourInput,
  RouteClassificationRow,
  RouteClassificationInput,
  EventVehiclePosition,
  OtpStopExclusion,
  PutStopExclusionInput,
  OtpDateExclusion,
  CreateDateExclusionInput,
  OtpAuditEntry,
  OtpReasonCode,
  ReasonCodeAppliesTo,
  CreateReasonCodeInput,
  UpdateReasonCodeInput,
  OtpSettingsRow,
  OtpMonthlyTrendPoint,
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

// The live API has been observed returning a bare scalar (e.g. a route number)
// for these fields instead of a JSON array - likely a not-yet-redeployed
// backend predating the current contract. Every consumer in both frontends
// calls array methods (.join, .includes, .forEach) on these directly, so a
// scalar here throws and - with no error boundary - takes down the whole
// React root. Normalize once, at the boundary where untrusted JSON enters the
// type system, so the ActiveMessage type's promise (string[]) is actually kept
// regardless of what the backend sends today.
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function normalizeActiveMessage(m: ActiveMessage): ActiveMessage {
  return {
    ...m,
    routes_affected: toStringArray(m.routes_affected),
    stops_affected: toStringArray(m.stops_affected),
    zones_affected: toStringArray(m.zones_affected),
    channels: toStringArray(m.channels),
  };
}

// Front Door has shown real edge-node propagation flakiness in this
// environment (a rule reported healthy by the control plane didn't apply
// consistently on every edge POP). A GET is safe to retry - unlike a write -
// so a transient network-level failure (fetch() rejecting outright, not an
// HTTP error response) gets a couple of quick retries before surfacing to
// the UI.
const GET_RETRY_DELAYS_MS = [500, 1500];

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= GET_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, GET_RETRY_DELAYS_MS[attempt]));
    }
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

    const method = (init.method ?? "GET").toUpperCase();
    const doFetch = method === "GET" ? fetchWithRetry : fetch;
    const res = await doFetch(`${root}${path}`, { ...init, headers });
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
    async getActiveMessages(filters?: { channel?: string; route?: string; zone?: string }) {
      const qs = new URLSearchParams();
      if (filters?.channel) qs.set("channel", filters.channel);
      if (filters?.route) qs.set("route", filters.route);
      if (filters?.zone) qs.set("zone", filters.zone);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const data = await request<{ messages: ActiveMessage[] }>(`/api/messages/active${suffix}`);
      return { messages: data.messages.map(normalizeActiveMessage) };
    },

    // Staff write - requires an Entra token (OCC.Publisher / OCC.Admin).
    createMessage(input: CreateMessageInput) {
      return request<CreateMessageResult>(
        "/api/messages",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    // Optional Compose action - turns internal report text into a rider-
    // friendly draft via Claude. Never persists anything; the result is just
    // returned for staff to review/edit before createMessage().
    draftMessageSummary(input: { raw_text: string; category: Category; severity: Severity }) {
      return request<{ summary: string }>(
        "/api/messages/draft-summary",
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

    prepareSuggestedAlert(input: PrepareSuggestedAlertInput) {
      return request<PrepareSuggestedAlertResult>(
        "/api/suggested-alerts/prepare",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
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

    getTripDelays() {
      return request<{ delays: TripDelay[]; diagnostics: TripDelayDiagnostics }>(
        "/api/trip-delays",
        {},
        true,
      );
    },

    getOnDemandRisks() {
      return request<{ risks: OnDemandRiskRecord[] }>("/api/on-demand-risks", {}, true);
    },

    getMissedTrips() {
      return request<{
        missed_trips: MissedTrip[];
        diagnostics: {
          configured: boolean;
          active_count?: number;
          resolved_count?: number;
          unreviewed_count?: number;
        };
      }>("/api/missed-trips", {}, true);
    },

    validateMissedTrip(input: ValidateMissedTripInput) {
      return request<{ trip_id: string; service_date: string; validation_status: string }>(
        "/api/missed-trips/validate",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getRoutes() {
      return request<{ routes: GtfsRouteOption[] }>("/api/routes", {}, true);
    },

    getAvailAvlVehicles() {
      return request<{
        vehicles: AvailAvlVehicle[];
        diagnostics: { configured: boolean; table_ready: boolean; vehicle_count: number; last_report_at: string | null };
      }>("/api/avail-avl", {}, true);
    },

    getFixedRouteDepartures(days?: number) {
      const suffix = days ? `?days=${days}` : "";
      return request<{
        departures: FixedRouteDeparture[];
        diagnostics: {
          configured: boolean;
          table_ready: boolean;
          record_count: number;
          late_count: number;
          expired_count: number;
          avg_delta_seconds: number | null;
        };
      }>(`/api/fixed-route-departures${suffix}`, {}, true);
    },

    getOtpMonthly(month?: string) {
      const suffix = month ? `?month=${month}` : "";
      return request<{
        stops: OtpMonthlyStopRow[];
        routes: OtpMonthlyRouteRollup[];
        diagnostics: {
          configured: boolean;
          table_ready: boolean;
          service_month: string;
          record_count: number;
          routes_below_90: number;
        };
      }>(`/api/otp-monthly${suffix}`, {}, true);
    },

    getAvailMissedTrips(month?: string) {
      const suffix = month ? `?month=${month}` : "";
      return request<{
        incidents: AvailMissedTripRecord[];
        routes: AvailMissedTripsRouteRollup[];
        diagnostics: {
          configured: boolean;
          table_ready: boolean;
          service_month: string;
          record_count: number;
          entire_trip_missed_count: number;
        };
      }>(`/api/avail-missed-trips${suffix}`, {}, true);
    },

    getDetours(status?: DetourStatus) {
      const suffix = status ? `?status=${status}` : "";
      return request<{ detours: Detour[] }>(`/api/detours${suffix}`, {}, true);
    },

    createDetour(input: CreateDetourInput) {
      return request<{ id: string; created_at: string }>(
        "/api/detours",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    updateDetour(id: string, input: UpdateDetourInput) {
      return request<{ id: string; updated_at: string }>(
        `/api/detours/${id}`,
        { method: "PATCH", body: JSON.stringify(input) },
        true,
      );
    },

    deleteDetour(id: string) {
      return request<{ id: string; is_deleted: boolean }>(
        `/api/detours/${id}`,
        { method: "DELETE" },
        true,
      );
    },

    getRouteClassification() {
      return request<{ routes: RouteClassificationRow[] }>("/api/route-classification", {}, true);
    },

    putRouteClassification(routeId: number, input: RouteClassificationInput) {
      return request<RouteClassificationRow>(
        `/api/route-classification/${routeId}`,
        { method: "PUT", body: JSON.stringify(input) },
        true,
      );
    },

    getEventVehiclePositions() {
      return request<{
        vehicles: EventVehiclePosition[];
        diagnostics: { table_ready: boolean; vehicle_count: number; last_report_at: string | null };
      }>("/api/event-vehicle-positions", {}, true);
    },

    getStopExclusions(month?: string) {
      const suffix = month ? `?month=${month}` : "";
      return request<{ exclusions: OtpStopExclusion[] }>(`/api/otp-stop-exclusions${suffix}`, {}, true);
    },

    putStopExclusion(input: PutStopExclusionInput) {
      return request<OtpStopExclusion>(
        "/api/otp-stop-exclusions",
        { method: "PUT", body: JSON.stringify(input) },
        true,
      );
    },

    getDateExclusions() {
      return request<{ exclusions: OtpDateExclusion[] }>("/api/otp-date-exclusions", {}, true);
    },

    createDateExclusion(input: CreateDateExclusionInput) {
      return request<OtpDateExclusion>(
        "/api/otp-date-exclusions",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getOtpAuditStream(month?: string, limit?: number) {
      const qs = new URLSearchParams();
      if (month) qs.set("month", month);
      if (limit) qs.set("limit", String(limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ entries: OtpAuditEntry[] }>(`/api/otp-audit-stream${suffix}`, {}, true);
    },

    getReasonCodes(appliesTo?: ReasonCodeAppliesTo, activeOnly?: boolean) {
      const qs = new URLSearchParams();
      if (appliesTo) qs.set("applies_to", appliesTo);
      if (activeOnly) qs.set("active_only", "true");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ reason_codes: OtpReasonCode[] }>(`/api/otp-reason-codes${suffix}`, {}, true);
    },

    createReasonCode(input: CreateReasonCodeInput) {
      return request<OtpReasonCode>(
        "/api/otp-reason-codes",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    updateReasonCode(id: string, input: UpdateReasonCodeInput) {
      return request<OtpReasonCode>(
        `/api/otp-reason-codes/${id}`,
        { method: "PATCH", body: JSON.stringify(input) },
        true,
      );
    },

    getOtpSettings() {
      return request<OtpSettingsRow>("/api/otp-settings", {}, true);
    },

    updateOtpSettings(earlyLateBiasThreshold: number) {
      return request<OtpSettingsRow>(
        "/api/otp-settings",
        { method: "PATCH", body: JSON.stringify({ early_late_bias_threshold: earlyLateBiasThreshold }) },
        true,
      );
    },

    getOtpMonthlyTrend(months?: number) {
      const suffix = months ? `?months=${months}` : "";
      return request<{ trend: OtpMonthlyTrendPoint[] }>(`/api/otp-monthly-trend${suffix}`, {}, true);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
