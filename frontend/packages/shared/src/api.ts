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
  MissedTripsDiagnostics,
  MissedTripReview,
  ValidateMissedTripInput,
  MissedTripsMonthlySummaryResponse,
  GtfsRouteOption,
  Category,
  Severity,
  AvailAvlVehicle,
  FixedRouteDeparture,
  OtpMonthlyStopRow,
  OtpDailyRow,
  OtpMonthlyRouteRollup,
  AvailMissedTripRecord,
  AvailMissedTripsRouteRollup,
  Detour,
  DetourStatus,
  CreateDetourInput,
  UpdateDetourInput,
  DetourReasonCode,
  RouteClassificationRow,
  RouteClassificationListResponse,
  RouteClassificationInput,
  EventVehiclePosition,
  EventMonitoringHealth,
  AppSettingRow,
  Event, EventLocation, EventGeofence, EventGeofencePurposeOption, EventGeofenceRule, EventGeofenceCrossing, EventGeofenceNotification, EventOperationalMessaging, EventServicePlan, EventServicePlanRevision, EventAuditEntry, EventVehicleAssignment,
  EventScopeException,
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
  OtpHistoricalBackfillInput,
  OtpHistoricalBackfillResponse,
  MapsTokenResponse,
  DetourAttachment,
  DetourImage,
  DetourIntake,
  CreateDetourIntakeInput,
  DetourFulfillmentMode,
  DetourLifecycleState,
  DetourCommunication,
  DetourHistoricalImportResult,
  DetourWorkflowHistoryEntry,
  ContractorPerformanceStandard,
  ContractorRecord,
  AssessmentPeriod,
  PeriodKpiAssessment,
  ComplianceOccurrence,
  ContractorStandardTier,
  ManualMetricEntry,
  ManagerAssessmentAction,
  DecisionMatrixProcedure,
  DecisionMatrixDiagnostics,
  DecisionMatrixCandidate,
  OnBoardAccessPrincipal,
  OnBoardDirectoryChange,
  OnBoardAccessChangeRecord,
  OnBoardAccessAuditEntry,
  OnBoardAccessMetadata,
  OnBoardSignInInformation,
  OnBoardAccessReconciliationReport,
} from "./types.js";

export interface TokenRequestOptions {
  authenticationContext?: string;
  forceRefresh?: boolean;
}

export type TokenProvider = (options?: TokenRequestOptions) => Promise<string | null>;

export interface ApiClientOptions {
  baseUrl: string;
  /** Optional: returns an access token for authenticated (write) calls. */
  getToken?: TokenProvider;
  privilegedAuthenticationContext?: string;
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

export interface FeedCheck {
  name: string;
  configured: boolean;
  status?: number;
  records?: number;
  keys?: string[];
  error?: string;
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

export function createApiClient({ baseUrl, getToken, privilegedAuthenticationContext = "c1" }: ApiClientOptions) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(
    path: string,
    init: RequestInit = {},
    authenticated: boolean | TokenRequestOptions = false,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated && getToken) {
      const token = await getToken(typeof authenticated === "object" ? authenticated : undefined);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const method = (init.method ?? "GET").toUpperCase();
    const doFetch = method === "GET" ? fetchWithRetry : fetch;
    let res = await doFetch(`${root}${path}`, { ...init, headers });
    if (res.status === 401 && authenticated && getToken) {
      const refreshedToken = await getToken({
        ...(typeof authenticated === "object" ? authenticated : {}),
        forceRefresh: true,
      });
      if (refreshedToken) {
        headers.set("Authorization", `Bearer ${refreshedToken}`);
        res = await doFetch(`${root}${path}`, { ...init, headers });
      }
    }
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

    publishMessage(id: string) {
      return request<{ message_id: string; status: "active" }>(
        `/api/messages/${id}/publish`,
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

    getDecisionMatrix(filters?: { q?: string; includeHistory?: boolean }) {
      const query = new URLSearchParams();
      if (filters?.q) query.set("q", filters.q);
      if (filters?.includeHistory) query.set("include_history", "true");
      const suffix = query.toString() ? `?${query.toString()}` : "";
      return request<{ procedures: DecisionMatrixProcedure[]; diagnostics: DecisionMatrixDiagnostics }>(
        `/api/decision-matrix${suffix}`,
        {},
        true,
      );
    },

    getDecisionMatrixMatches(input: { conditionKey?: string; q?: string; source?: string; sourceId?: string }) {
      const query = new URLSearchParams();
      if (input.conditionKey) query.set("condition_key", input.conditionKey);
      if (input.q) query.set("q", input.q);
      if (input.source) query.set("source", input.source);
      if (input.sourceId) query.set("source_id", input.sourceId);
      return request<{ candidates: DecisionMatrixCandidate[]; context: { source: string | null; source_id: string | null } }>(`/api/decision-matrix/matches?${query}`, {}, true);
    },

    syncDecisionMatrix() {
      return request<{ status: string; count: number; reason?: string }>(
        "/api/admin/decision-matrix/sync",
        { method: "POST" },
        true,
      );
    },

    governDecisionMatrix(procedureId: string, revision: number, action: "approve" | "retire", reason?: string) {
      return request<{ procedure_id: string; revision: number; approval_state: string; trust_state: string }>(
        `/api/admin/decision-matrix/${encodeURIComponent(procedureId)}/${revision}`,
        { method: "PATCH", body: JSON.stringify({ action, reason }) },
        true,
      );
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

    getFeedChecks() {
      return request<{ checked_at: string; checks: FeedCheck[] }>("/api/feed-checks", {}, true);
    },

    getMissedTrips(view: "queue" | "history" | "all" = "queue", limit = 200, offset = 0) {
      return request<{
        missed_trips: MissedTrip[];
        diagnostics: MissedTripsDiagnostics;
      }>(`/api/missed-trips?view=${view}&limit=${limit}&offset=${offset}`, {}, true);
    },

    validateMissedTrip(input: ValidateMissedTripInput) {
      return request<{ trip_id: string; service_date: string; validation_status: string; reason_code: string | null }>(
        "/api/missed-trips/validate",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getMissedTripReviews(tripId: string, serviceDate: string) {
      const query = new URLSearchParams({ trip_id: tripId, service_date: serviceDate });
      return request<{ reviews: MissedTripReview[] }>(`/api/missed-trips/reviews?${query}`, {}, true);
    },

    getMissedTripsMonthlySummary() {
      return request<MissedTripsMonthlySummaryResponse>("/api/missed-trips-monthly-summary", {}, true);
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
          routes_below_target: number;
          target: number;
        };
      }>(`/api/otp-monthly${suffix}`, {}, true);
    },

    getOtpDaily(params?: { start?: string; end?: string; route_id?: number }) {
      const q = new URLSearchParams();
      if (params?.start) q.set("start", params.start);
      if (params?.end) q.set("end", params.end);
      if (params?.route_id !== undefined) q.set("route_id", String(params.route_id));
      const suffix = q.toString() ? `?${q.toString()}` : "";
      return request<{
        rows: OtpDailyRow[];
        diagnostics: { table_ready: boolean; start: string; end: string; record_count: number };
      }>(`/api/otp-daily${suffix}`, {}, true);
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

    getOperationsDetourReport() {
      return request<{ detours: Detour[]; report: Array<Record<string, unknown>> }>(`/api/detours?view=operations`, {}, true);
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

    recordAvailEntry(id: string, input: { result: "entered" | "conflict" | "not_entered"; external_detour_id?: string | null; detail?: string | null }) {
      return request<{ id: string; result: string; lifecycle_state: DetourLifecycleState }>(
        `/api/detours/${id}/avail-entry`,
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    changeDetourFulfillment(id: string, input: { fulfillment_mode: "fixed_route_manual"; reason: string }) {
      return request<{ id: string; fulfillment_mode: string; lifecycle_state: DetourLifecycleState; readiness: string }>(
        `/api/detours/${id}/fulfillment`,
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getDetourCommunications(id: string) {
      return request<{ communications: DetourCommunication[] }>(`/api/detours/${id}/communications`, {}, true);
    },

    createDetourCommunication(id: string, input: { audience: string; channel: string; recipients?: string | null; content: string }) {
      return request<DetourCommunication>(`/api/detours/${id}/communications`, { method: "POST", body: JSON.stringify(input) }, true);
    },

    publishDetourCommunication(detourId: string, communicationId: string, outcome?: string) {
      return request<DetourCommunication>(`/api/detours/${detourId}/communications/${communicationId}/publish`, { method: "POST", body: JSON.stringify({ outcome }) }, true);
    },

    importHistoricalDetours(input: { source_file: string; rows: Array<Record<string, unknown>> }) {
      return request<DetourHistoricalImportResult>(`/api/detours/historical-imports`, { method: "POST", body: JSON.stringify(input) }, true);
    },

    closeDetour(id: string, reason: string) {
      return request<{ id: string; lifecycle_state: DetourLifecycleState; closure_reason: string }>(`/api/detours/${id}/close`, { method: "POST", body: JSON.stringify({ reason }) }, true);
    },

    deleteDetour(id: string) {
      return request<{ id: string; is_deleted: boolean }>(
        `/api/detours/${id}`,
        { method: "DELETE" },
        true,
      );
    },

    // Detour reason categories - Part B6. Returns an empty list (not an
    // error) until migration-025 has run.
    getDetourReasonCodes(activeOnly = false) {
      const suffix = activeOnly ? "?active_only=true" : "";
      return request<{ reason_codes: DetourReasonCode[] }>(`/api/detour-reason-codes${suffix}`, {}, true);
    },

    createDetourReasonCode(input: { code: string; label: string; sort_order?: number }) {
      return request<DetourReasonCode>(
        "/api/detour-reason-codes",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    updateDetourReasonCode(id: string, input: { label?: string; is_active?: boolean; sort_order?: number }) {
      return request<DetourReasonCode>(
        `/api/detour-reason-codes/${id}`,
        { method: "PATCH", body: JSON.stringify(input) },
        true,
      );
    },

    getDetourImageUploadUrl(detourId: string, fileName: string, contentType?: string) {
      return request<{ upload_url: string; blob_path: string }>(
        `/api/detours/${detourId}/images/upload-url`,
        { method: "POST", body: JSON.stringify({ file_name: fileName, content_type: contentType }) },
        true,
      );
    },

    createDetourImage(
      detourId: string,
      input: { blob_path: string; file_name: string; content_type?: string; size_bytes?: number; caption?: string },
    ) {
      return request<DetourImage>(
        `/api/detours/${detourId}/images`,
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getDetourImages(detourId: string) {
      return request<{ images: DetourImage[] }>(`/api/detours/${detourId}/images`, {}, true);
    },

    getDetourAttachments(owner: { intake_id?: string; detour_id?: string }, options?: { include_private?: boolean }) {
      const query = new URLSearchParams({ ...owner, ...(options?.include_private ? { include_private: "1" } : {}) }).toString();
      return request<{ attachments: DetourAttachment[] }>(`/api/detour-attachments?${query}`, {}, true);
    },

    getDetourAttachmentReadiness() {
      return request<{ configured: boolean }>("/api/detour-attachments/readiness", {}, true);
    },

    getDetourAttachmentUploadUrl(owner: { intake_id?: string; detour_id?: string }, file: { file_name: string; content_type: string; size_bytes: number }, options?: { attachment_id?: string; version_of?: string }) {
      return request<{ attachment_id: string; upload_url: string; blob_path: string; availability_state: string }>(
        "/api/detour-attachments/upload-url",
        { method: "POST", body: JSON.stringify({ ...owner, ...file, ...options }) },
        true,
      );
    },

    createDetourAttachment(input: { intake_id?: string; detour_id?: string; attachment_id?: string; version_of?: string; blob_path: string; file_name: string; content_type: string; size_bytes: number; content_sha256?: string }) {
      return request<DetourAttachment>(
        "/api/detour-attachments",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    removeDetourAttachment(id: string) {
      return request<void>(`/api/detour-attachments/${id}`, { method: "DELETE" }, true);
    },

    shareDetourAttachment(id: string, reason: string) {
      return request<{ id: string; report_shared: boolean }>(`/api/detour-attachments/${id}/share`, { method: "POST", body: JSON.stringify({ reason }) }, true);
    },

    unshareDetourAttachment(id: string, reason: string) {
      return request<{ id: string; report_shared: boolean }>(`/api/detour-attachments/${id}/unshare`, { method: "POST", body: JSON.stringify({ reason }) }, true);
    },

    getDetourIntake(status?: string) {
      const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
      return request<{ intake: DetourIntake[] }>(`/api/detour-intake${suffix}`, {}, true);
    },

    getDetourIntakeOptions(type?: string) {
      const suffix = type ? `?type=${encodeURIComponent(type)}` : "";
      return request<{ options: Array<{ id: string; option_type: string; code: string; label: string; is_active: boolean; sort_order: number }> }>(`/api/detour-intake-options${suffix}`, {}, true);
    },

    createDetourIntakeOption(input: { option_type: string; code: string; label: string; sort_order?: number }) {
      return request<{ id: string; option_type: string; code: string; label: string; is_active: boolean; sort_order: number }>("/api/detour-intake-options", { method: "POST", body: JSON.stringify(input) }, true);
    },

    updateDetourIntakeOption(id: string, input: { label?: string; is_active?: boolean; sort_order?: number }) {
      return request<{ id: string; option_type: string; code: string; label: string; is_active: boolean; sort_order: number }>(`/api/detour-intake-options/${id}`, { method: "PATCH", body: JSON.stringify(input) }, true);
    },

    createDetourIntake(input: CreateDetourIntakeInput) {
      return request<{ id: string; created_at: string }>(
        "/api/detour-intake",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    reviewDetourIntake(
      id: string,
      input: {
        status: "needs_information" | "rejected" | "duplicate" | "withdrawn";
        decision_notes?: string;
        duplicate_of_intake_id?: string;
        duplicate_of_detour_id?: string;
      },
    ) {
      return request<{ id: string; status: string }>(
        `/api/detour-intake/${id}`,
        { method: "PATCH", body: JSON.stringify(input) },
        true,
      );
    },

    promoteDetourIntake(id: string, fulfillment_mode: DetourFulfillmentMode, dates?: { start_date?: string | null; end_date?: string | null }) {
      return request<{ id: string; created_at: string; lifecycle_state: string }>(
        `/api/detour-intake/${id}/promote`,
        { method: "POST", body: JSON.stringify({ fulfillment_mode, ...dates }) },
        true,
      );
    },

    updateDetourWorkflow(id: string, lifecycle_state: DetourLifecycleState) {
      return request<{ id: string; lifecycle_state: DetourLifecycleState }>(
        `/api/detours/${id}/workflow`,
        { method: "PATCH", body: JSON.stringify({ lifecycle_state }) },
        true,
      );
    },

    getDetourWorkflowHistory(id: string) {
      return request<{ history: DetourWorkflowHistoryEntry[] }>(
        `/api/detours/${id}/workflow-history`,
        {},
        true,
      );
    },

    getRouteClassification() {
      return request<RouteClassificationListResponse>("/api/route-classification", {}, true);
    },

    putRouteClassification(routeId: number, input: RouteClassificationInput) {
      return request<RouteClassificationRow>(
        `/api/route-classification/${routeId}`,
        { method: "PUT", body: JSON.stringify(input) },
        true,
      );
    },

    deleteRouteClassification(routeId: number) {
      return request<{ route_id: number }>(
        `/api/route-classification/${routeId}`,
        { method: "DELETE" },
        true,
      );
    },

    getEventVehiclePositions(eventId?: string, servicePlanId?: string) {
      const query = new URLSearchParams(); if (eventId) query.set("event_id", eventId); if (servicePlanId) query.set("service_plan_id", servicePlanId);
      const suffix = query.toString() ? `?${query}` : "";
      return request<{
        vehicles: EventVehiclePosition[];
        unassigned_vehicles: EventVehiclePosition[];
        scope_exceptions: EventScopeException[];
        diagnostics: { table_ready: boolean; vehicle_count: number; managed_vehicle_count?: number; unassigned_vehicle_count?: number; last_report_at: string | null; source?: string; stale_vehicle_count?: number };
      }>(`/api/event-vehicle-positions${suffix}`, {}, true);
    },
    getEventVehicleAssignments(eventId?: string) {
      const suffix = eventId ? `?event_id=${encodeURIComponent(eventId)}` : "";
      return request<{ assignments: EventVehicleAssignment[] }>(`/api/event-vehicle-assignments${suffix}`, {}, true);
    },
    createEventVehicleAssignment(input: { event_id: string; service_plan_id: string; vehicle_id: number; route_id: number; reason?: string }) {
      return request<EventVehicleAssignment>("/api/event-vehicle-assignments", { method: "POST", body: JSON.stringify(input) }, true);
    },
    transitionEventVehicleAssignment(id: string, action: "approve" | "reject") {
      return request<{ status: string; target?: string; revision_id?: string }>(`/api/event-vehicle-assignments/${id}/${action}`, { method: "POST" }, true);
    },

    getEventMonitoringHealth(eventId?: string, servicePlanId?: string) {
      const qs = new URLSearchParams(); if (eventId) qs.set("event_id", eventId); if (servicePlanId) qs.set("service_plan_id", servicePlanId);
      const suffix = qs.toString() ? `?${qs}` : "";
      return request<EventMonitoringHealth>(`/api/event-monitoring-health${suffix}`, {}, true);
    },

    getEventOperationalMessaging(servicePlanId: string) { return request<EventOperationalMessaging>(`/api/event-operational-messaging?service_plan_id=${encodeURIComponent(servicePlanId)}`, {}, true); },
    updateEventOperationalMessaging(servicePlanId: string, automatic_teams_enabled: boolean) { return request<EventOperationalMessaging>(`/api/event-operational-messaging?service_plan_id=${encodeURIComponent(servicePlanId)}`, { method: "PATCH", body: JSON.stringify({ automatic_teams_enabled }) }, true); },

    getAppSettings(module: string) {
      return request<{ settings: AppSettingRow[] }>(
        `/api/app-settings?module=${encodeURIComponent(module)}`,
        {},
        true,
      );
    },

    updateAppSetting(module: string, setting_key: string, setting_value: string) {
      return request<AppSettingRow>(
        `/api/app-settings?module=${encodeURIComponent(module)}`,
        { method: "PATCH", body: JSON.stringify({ setting_key, setting_value }) },
        true,
      );
    },

    getEventLocations() { return request<{ locations: EventLocation[] }>("/api/event-locations", {}, true); },
    createEventLocation(input: Omit<EventLocation, "id" | "is_active">) { return request<EventLocation>("/api/event-locations", { method: "POST", body: JSON.stringify(input) }, true); },
    updateEventLocation(id: string, input: Partial<EventLocation>) { return request<EventLocation>(`/api/event-locations/${id}`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    getEventGeofencePurposes() { return request<{ purposes: EventGeofencePurposeOption[] }>("/api/event-geofence-purposes", {}, true); },
    createEventGeofencePurpose(input: Pick<EventGeofencePurposeOption, "code" | "label">) { return request<EventGeofencePurposeOption>("/api/event-geofence-purposes", { method: "POST", body: JSON.stringify(input) }, true); },
    updateEventGeofencePurpose(code: string, input: Pick<EventGeofencePurposeOption, "label">) { return request<EventGeofencePurposeOption>(`/api/event-geofence-purposes/${encodeURIComponent(code)}`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    deleteEventGeofencePurpose(code: string) { return request<void>(`/api/event-geofence-purposes/${encodeURIComponent(code)}`, { method: "DELETE" }, true); },
    getEventGeofences() { return request<{ geofences: EventGeofence[] }>("/api/event-geofences", {}, true); },
    createEventGeofence(input: Pick<EventGeofence, "name" | "polygon" | "purpose">) { return request<EventGeofence>("/api/event-geofences", { method: "POST", body: JSON.stringify(input) }, true); },
    updateEventGeofence(id: string, input: Partial<Pick<EventGeofence, "name" | "polygon" | "purpose">> & { is_active?: boolean }) { return request<EventGeofence>(`/api/event-geofences/${id}`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    addEventGeofenceRule(id: string, input: Omit<EventGeofenceRule, "id" | "geofence_id">) { return request<EventGeofenceRule>(`/api/event-geofences/${id}/rules`, { method: "POST", body: JSON.stringify(input) }, true); },
    updateEventGeofenceRule(geofenceId: string, ruleId: string, input: Omit<EventGeofenceRule, "id" | "geofence_id">) { return request<EventGeofenceRule>(`/api/event-geofences/${geofenceId}/rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    deleteEventGeofenceRule(geofenceId: string, ruleId: string) { return request<void>(`/api/event-geofences/${geofenceId}/rules/${ruleId}`, { method: "DELETE" }, true); },
    getEventGeofenceCrossings(eventId?: string, servicePlanId?: string) { const qs = new URLSearchParams(); if (eventId) qs.set("event_id", eventId); if (servicePlanId) qs.set("service_plan_id", servicePlanId); const suffix = qs.toString() ? `?${qs}` : ""; return request<{ crossings: EventGeofenceCrossing[] }>(`/api/event-geofence-crossings${suffix}`, {}, true); },
    getEventGeofenceNotifications(status: "pending" | "all" = "pending", eventId?: string, servicePlanId?: string) { const qs = new URLSearchParams({ status }); if (eventId) qs.set("event_id", eventId); if (servicePlanId) qs.set("service_plan_id", servicePlanId); return request<{ notifications: EventGeofenceNotification[] }>(`/api/event-geofence-notifications?${qs}`, {}, true); },
    sendEventGeofenceNotification(id: string) { return request<{ ok: boolean }>(`/api/event-geofence-notifications/${id}/send`, { method: "POST" }, true); },
    acknowledgeEventGeofenceNotification(id: string) { return request<{ ok: boolean }>(`/api/event-geofence-notifications/${id}/acknowledge`, { method: "POST" }, true); },
    dismissEventGeofenceNotification(id: string) { return request<{ ok: boolean }>(`/api/event-geofence-notifications/${id}/dismiss`, { method: "POST" }, true); },
    getEvents() { return request<{ events: Event[] }>("/api/events", {}, true); },
    createEvent(input: Pick<Event, "name" | "description" | "owning_team">) { return request<Event>("/api/events", { method: "POST", body: JSON.stringify(input) }, true); },
    updateEvent(id: string, input: Partial<Pick<Event, "name" | "description" | "owning_team">>) { return request<Event>(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    getEventServicePlans() { return request<{ plans: EventServicePlan[] }>("/api/event-service-plans", {}, true); },
    createEventServicePlan(input: { name: string; event_id: string; start_at?: string; end_at?: string }) { return request<EventServicePlan>("/api/event-service-plans", { method: "POST", body: JSON.stringify(input) }, true); },
    updateEventServicePlan(id: string, input: { name?: string; start_at?: string; end_at?: string }) { return request<EventServicePlan>(`/api/event-service-plans/${id}/details`, { method: "PATCH", body: JSON.stringify(input) }, true); },
    advanceEventServicePlan(id: string) { return request<EventServicePlan>(`/api/event-service-plans/${id}/advance`, { method: "POST" }, true); },
    transitionEventServicePlan(id: string, action: "submit-review" | "approve" | "advance" | "complete" | "suspend", conflict_override_reason?: string) { return request<EventServicePlan>(`/api/event-service-plans/${id}/${action}`, { method: "POST", body: conflict_override_reason ? JSON.stringify({ conflict_override_reason }) : undefined }, true); },
    modifyEventServicePlan(id: string) { return request<EventServicePlanRevision>(`/api/event-service-plans/${id}/modify`, { method: "POST" }, true); },
    repairEventServicePlan(id: string) { return request<EventServicePlan>(`/api/event-service-plans/${id}/repair`, { method: "POST" }, true); },
    linkEventServicePlan(id: string, kind: "routes" | "geofences" | "locations", value: string | number, revisionId?: string) { const query = revisionId ? `?revision_id=${encodeURIComponent(revisionId)}` : ""; return request<{ ok: boolean }>(`/api/event-service-plans/${id}/${kind}${query}`, { method: "POST", body: JSON.stringify({ [`${kind === "routes" ? "route_id" : kind === "geofences" ? "geofence_id" : "location_id"}`]: value }) }, true); },
    unlinkEventServicePlan(id: string, kind: "routes" | "geofences" | "locations", value: string | number, revisionId?: string) { const query = revisionId ? `?revision_id=${encodeURIComponent(revisionId)}` : ""; return request<void>(`/api/event-service-plans/${id}/${kind}/${encodeURIComponent(String(value))}${query}`, { method: "DELETE" }, true); },
    transitionEventServicePlanRevision(id: string, revisionId: string, action: "submit-review" | "approve" | "apply" | "reject") { return request<{ ok: boolean; status: string }>(`/api/event-service-plans/${id}/revisions/${revisionId}/${action}`, { method: "POST" }, true); },
    getEventAuditStream(from?: string, to?: string, eventId?: string, servicePlanId?: string) { const qs = new URLSearchParams(); if (from) qs.set("from", from); if (to) qs.set("to", to); if (eventId) qs.set("event_id", eventId); if (servicePlanId) qs.set("service_plan_id", servicePlanId); return request<{ entries: EventAuditEntry[] }>(`/api/event-module-audit-stream?${qs}`, {}, true); },

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

    runOtpHistoricalBackfill(input: OtpHistoricalBackfillInput) {
      return request<OtpHistoricalBackfillResponse>(
        "/api/otp-historical-backfill",
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },

    getMapsToken() {
      return request<MapsTokenResponse>("/api/maps/token", {}, true);
    },

    getPerformanceStandards() {
      return request<{ standards: ContractorPerformanceStandard[]; tiers: ContractorStandardTier[]; diagnostics: { table_ready: boolean } }>("/api/performance-standards", {}, true);
    },
    getContractors() {
      return request<{ contractors: ContractorRecord[]; diagnostics: { table_ready: boolean } }>("/api/contractors", {}, true);
    },
    putContractor(id: string, input: { name: string; contract_start_date: string; contract_end_date: string | null; is_active: boolean }) {
      return request<{ id: string }>(`/api/contractors/${id}`, { method: "PUT", body: JSON.stringify(input) }, true);
    },
    getAssessmentPeriods() {
      return request<{ periods: AssessmentPeriod[]; diagnostics: { table_ready: boolean } }>("/api/assessment-periods", {}, true);
    },
    openAssessmentPeriod(contractor_id: string, service_month: string) {
      return request<{ id: string }>("/api/assessment-periods", { method: "POST", body: JSON.stringify({ contractor_id, service_month }) }, true);
    },
    computeAssessmentPeriod(id: string) {
      return request<{ id: string; status: string }>(`/api/assessment-periods/${id}/compute`, { method: "POST" }, true);
    },
    finalizeAssessmentPeriod(id: string) {
      return request<{ id: string; status: string }>(`/api/assessment-periods/${id}/finalize`, { method: "POST" }, true);
    },
    getPeriodAssessments(periodId: string) {
      return request<{ assessments: PeriodKpiAssessment[] }>(`/api/period-assessments?period_id=${encodeURIComponent(periodId)}`, {}, true);
    },
    reviewPeriodAssessment(id: string, manager_action: Exclude<ManagerAssessmentAction, "pending">, final_amount?: number, manager_reason?: string) {
      return request<{ id: string }>(`/api/period-assessments/${id}`, { method: "PATCH", body: JSON.stringify({ manager_action, final_amount, manager_reason }) }, true);
    },
    getAssessmentReports(periodId: string) {
      return request<{ reports: import("./types.js").AssessmentReport[] }>(`/api/assessment-reports?period_id=${encodeURIComponent(periodId)}`, {}, true);
    },
    createAssessmentReport(period_id: string, issuance_type: "preliminary" | "final") {
      return request<{ id: string; version: number; content_sha256: string }>("/api/assessment-reports", { method: "POST", body: JSON.stringify({ period_id, issuance_type }) }, true);
    },
    shareValidationDraft(periodId: string, report_id: string, recipient: string, sender_attestation: string) {
      return request<{ status: string; validation_ends_on: string }>(`/api/assessment-periods/${periodId}/validation-share`, { method: "POST", body: JSON.stringify({ report_id, recipient, delivery_method: "email", sender_attestation }) }, true);
    },
    issueAssessmentReport(id: string, recipient: string, sender_attestation: string) {
      return request<{ id: string; status: string; content_sha256: string; dispute_deadline_at: string }>(`/api/assessment-reports/${id}/issue`, { method: "POST", body: JSON.stringify({ recipient, delivery_method: "email", sender_attestation }) }, true);
    },
    getAssessmentCaps(periodId: string) {
      return request<{ caps: import("./types.js").AssessmentCap[] }>(`/api/assessment-caps?period_id=${encodeURIComponent(periodId)}`, {}, true);
    },
    getAssessmentDisputes(periodId: string) {
      return request<{ disputes: import("./types.js").AssessmentDispute[] }>(`/api/assessment-disputes?period_id=${encodeURIComponent(periodId)}`, {}, true);
    },
    createAssessmentDispute(report_id: string, assessment_ids: string[], basis: string) {
      return request<{ id: string }>("/api/assessment-disputes", { method: "POST", body: JSON.stringify({ report_id, assessment_ids, basis }) }, true);
    },
    decideAssessmentDispute(id: string, outcome: "upheld" | "adjusted" | "rescinded" | "superseded", note: string, credit_amount?: number) {
      return request<{ id: string; status: string }>(`/api/assessment-disputes/${id}/decision`, { method: "POST", body: JSON.stringify({ outcome, note, credit_amount }) }, true);
    },
    getAssessmentEvidence(assessmentId: string) {
      return request<{ evidence: import("./types.js").AssessmentEvidence[] }>(`/api/assessment-evidence?assessment_id=${encodeURIComponent(assessmentId)}`, {}, true);
    },
    getAssessmentEvidenceUploadUrl(assessment_id: string, file_name: string) {
      return request<{ upload_url: string; blob_path: string }>("/api/assessment-evidence/upload-url", { method: "POST", body: JSON.stringify({ assessment_id, file_name }) }, true);
    },
    createAssessmentEvidence(input: { assessment_id: string; blob_path: string; content_type: string; file_size_bytes: number; content_sha256: string; visibility: "internal" | "contractor"; caption?: string; supersedes_id?: string }) {
      return request<{ id: string }>("/api/assessment-evidence", { method: "POST", body: JSON.stringify(input) }, true);
    },
    getComplianceOccurrences() {
      return request<{ occurrences: ComplianceOccurrence[]; diagnostics: { table_ready: boolean } }>("/api/compliance-occurrences", {}, true);
    },
    reviewComplianceOccurrence(id: string, review_status: "candidate" | "confirmed" | "dismissed", attribution: "contractor_error" | "excusable" | "mvta_directed" | "undetermined", dismiss_reason?: string) {
      return request<{ id: string }>(`/api/compliance-occurrences/${id}`, { method: "PATCH", body: JSON.stringify({ review_status, attribution, dismiss_reason }) }, true);
    },
    getManualMetrics() {
      return request<{ metrics: ManualMetricEntry[]; diagnostics: { table_ready: boolean } }>("/api/manual-metrics", {}, true);
    },
    putManualMetric(input: { standard_id: string; contractor_id: string; service_month: string; metric_value: number; source_note: string }) {
      return request<{ id: string }>("/api/manual-metrics", { method: "PUT", body: JSON.stringify(input) }, true);
    },

    getAccessPrincipals() {
      return request<{ environment: string; access_admin_fallback: boolean; principals: OnBoardAccessPrincipal[] }>(
        "/api/access-management/principals", {}, true,
      );
    },
    searchAccessDirectory(query: string) {
      return request<{ candidates: OnBoardAccessPrincipal[] }>(
        `/api/access-management/directory/search?q=${encodeURIComponent(query)}`, {}, true,
      );
    },
    previewAccessChanges(changes: OnBoardDirectoryChange[]) {
      return request<{
        environment: string;
        valid: boolean;
        items: Array<{ index: number; disposition: "invalid" | "already_satisfied" | "immediate" | "approval_required"; errors: string[] }>;
      }>(
        "/api/access-management/changes/preview",
        { method: "POST", body: JSON.stringify({ changes }) },
        true,
      );
    },
    submitAccessChanges(changes: OnBoardDirectoryChange[], idempotencyKey: string) {
      const privileged = changes.some((change) => change.role === "OCC.Admin" || change.role === "OCC.AccessAdmin");
      return request<{
        environment: string;
        results: Array<{ index: number; disposition: string; correlation_id?: string | null; change_id?: string; errors?: string[]; message?: string }>;
      }>(
        "/api/access-management/changes",
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ changes }) },
        privileged ? { authenticationContext: privilegedAuthenticationContext } : true,
      );
    },
    getPendingAccessChanges() {
      return request<{ changes: OnBoardAccessChangeRecord[] }>(
        "/api/access-management/changes", {}, true,
      );
    },
    decideAccessChange(id: string, decision: "approved" | "rejected", idempotencyKey: string) {
      return request<{ change_id: string; status: string; result: { status: string; correlation_id: string | null } | null }>(
        `/api/access-management/changes/${encodeURIComponent(id)}/decision`,
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ decision }) },
        { authenticationContext: privilegedAuthenticationContext },
      );
    },
    cancelAccessChange(id: string, reason: string) {
      return request<{ change_id: string; status: "cancelled" }>(
        `/api/access-management/changes/${encodeURIComponent(id)}/cancel`,
        { method: "POST", body: JSON.stringify({ reason }) },
        true,
      );
    },
    getAccessSignIns(principalId: string) {
      return request<OnBoardSignInInformation>(
        `/api/access-management/principals/${encodeURIComponent(principalId)}/sign-ins`, {}, true,
      );
    },
    getAccessAudit() {
      return request<{ audit: OnBoardAccessAuditEntry[] }>(
        "/api/access-management/audit", {}, true,
      );
    },
    getAccessExpirations() {
      return request<{ expirations: OnBoardAccessMetadata[] }>(
        "/api/access-management/expirations", {}, true,
      );
    },
    applyAccessExpirations(idempotencyKey: string) {
      return request<{ environment: string; results: Array<{ metadata_id: string; disposition: string; message?: string }> }>(
        "/api/access-management/expirations/apply",
        { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
        true,
      );
    },
    getAccessReconciliation() {
      return request<OnBoardAccessReconciliationReport>(
        "/api/access-management/reconciliation", {}, true,
      );
    },
    exportAccessInventory() {
      return request<{
        environment: string;
        generated_at: string;
        rows: Array<{
          display_name: string; sign_in_name: string | null; principal_type: string;
          account_enabled: boolean | null; guest_state: string | null; role: string;
          effective_roles: string[]; reconciliation_status: string;
          source: string; source_name: string; expires_at: string | null;
          sponsor: string | null; organization: string | null;
        }>;
      }>("/api/access-management/export", { method: "POST" }, true);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
