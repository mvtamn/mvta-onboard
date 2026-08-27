import { describe, expect, it } from "vitest";
import { activePlansMissingPublishedScope, defaultMonitoringEventId, defaultMonitoringServicePlanId, deriveEventMonitoringDataState, eventVehiclePositionQuery, isOpenEventNotificationStatus } from "./eventMonitoringState.js";
import type { DeriveEventMonitoringDataStateInput } from "./eventMonitoringState.js";
import type { Event, EventServicePlan } from "@mvta/shared";

const event = (id: string, name = id): Event => ({
  id, name, description: null, owning_team: null, created_by: "test",
  created_at: "2026-01-01T00:00:00.000Z", updated_by: null, updated_at: "2026-01-01T00:00:00.000Z",
});

const plan = (event_id: string, status: EventServicePlan["status"], published_scope: EventServicePlan["published_scope"] = null): EventServicePlan => ({
  id: `${event_id}-${status}`, event_id, name: "Service", status,
  start_date: null, end_date: null, start_at: "2026-08-12T12:00:00.000Z", end_at: "2026-08-12T18:00:00.000Z",
  created_by: "test", created_at: "2026-01-01T00:00:00.000Z", updated_by: null, updated_at: "2026-01-01T00:00:00.000Z",
  links: [], revisions: [], published_scope,
});

describe("Event AVL monitoring state", () => {
  it("auto-selects the Event with the sole active Service Plan", () => {
    expect(defaultMonitoringEventId([event("active")], [plan("active", "active")])).toBe("active");
  });

  it("does not auto-select when multiple active Service Plans exist", () => {
    expect(defaultMonitoringEventId([event("one"), event("two")], [plan("one", "active"), plan("two", "active")])).toBe("");
  });

  it("does not fall back to a prepared Service Plan", () => {
    expect(defaultMonitoringEventId([event("prepared")], [plan("prepared", "approved")])).toBe("");
  });

  it("auto-selects the sole active Service Plan for an already selected Event", () => {
    expect(defaultMonitoringServicePlanId("active", [plan("active", "active")])).toBe("active-active");
    expect(defaultMonitoringServicePlanId("active", [plan("active", "active"), { ...plan("active", "active"), id: "active-2" }])).toBe("");
  });

  it("identifies active plans without a published runtime scope", () => {
    expect(activePlansMissingPublishedScope([plan("missing", "active"), plan("ready", "active", { routes: [], geofences: [], locations: [] })]).map((row) => row.id)).toEqual(["missing-active"]);
  });

  it("keeps the live AVL feed unscoped until an Event is selected", () => {
    expect(eventVehiclePositionQuery("", "")).toEqual({ eventId: undefined, servicePlanId: undefined });
    expect(eventVehiclePositionQuery("event-1", "plan-1")).toEqual({ eventId: "event-1", servicePlanId: "plan-1" });
  });

  it("keeps pending, acknowledged, sending, and failed notifications in the open queue", () => {
    expect(["pending", "acknowledged", "sending", "failed", "sent", "dismissed"].filter(isOpenEventNotificationStatus)).toEqual(["pending", "acknowledged", "sending", "failed"]);
  });
});

describe("Event AVL monitoring data state (ADR-0020 trust states)", () => {
  const base: DeriveEventMonitoringDataStateInput = {
    authenticationExpired: false,
    loadError: null,
    vehicles: null,
    hasOperatingContext: false,
    activePlanCount: 0,
    requiresPlanSelection: false,
    missingPublishedScopePlanNames: [],
    health: null,
    degradedComponentNames: [],
  };

  it("reports Authentication required when the load failed with a 401", () => {
    const state = deriveEventMonitoringDataState({ ...base, authenticationExpired: true, loadError: "Your OnBoard session has expired. Sign in again to load live vehicle positions." });
    expect(state.tone).toBe("error");
    expect(state.title).toBe("Event AVL needs you to sign in again.");
  });

  it("does not claim session expiry for a non-auth load failure", () => {
    const state = deriveEventMonitoringDataState({ ...base, authenticationExpired: false, loadError: "Could not reach the live vehicle-position service." });
    expect(state.title).not.toMatch(/sign in/i);
    expect(state.tone).toBe("error");
    expect(state.action).toBe("Could not reach the live vehicle-position service.");
  });

  it("shows a connecting state before the first unscoped load resolves", () => {
    expect(deriveEventMonitoringDataState({ ...base, vehicles: null }).tone).toBe("info");
  });

  it("shows the unscoped shared-AVL feed once an Event is selected", () => {
    const withVehicles = deriveEventMonitoringDataState({ ...base, vehicles: [{}] });
    expect(withVehicles.tone).toBe("success");
    const empty = deriveEventMonitoringDataState({ ...base, vehicles: [] });
    expect(empty.tone).toBe("warning");
  });

  it("requires an active operating period before scoped states apply", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 0 });
    expect(state.title).toBe("This Event has no active operating period.");
  });

  it("requires explicit operating-period selection with multiple active plans", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 2, requiresPlanSelection: true });
    expect(state.title).toBe("Select an operating period to monitor this Event.");
  });

  it("reports missing published scope as Unavailable rather than Degraded", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, missingPublishedScopePlanNames: ["Downtown Marathon"] });
    expect(state.tone).toBe("error");
    expect(state.title).toBe("Published Event AVL scope is unavailable.");
  });

  it("reports Unavailable when health and vehicles both failed to load with no prior error message", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, health: null, vehicles: null });
    expect(state.title).toBe("Event AVL data is unavailable.");
  });

  it("reports Degraded when vehicles load but a supporting capability is unhealthy", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, health: {}, vehicles: [{}], degradedComponentNames: ["crossing detection"] });
    expect(state.tone).toBe("warning");
    expect(state.action).toContain("crossing detection");
  });

  it("reports Live when vehicles are present and nothing is degraded", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, health: {}, vehicles: [{}] });
    expect(state).toEqual({ tone: "success", title: "Event AVL data is flowing.", action: null });
  });

  it("reports Stale when every visible vehicle is stale", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, health: {}, vehicles: [{ is_stale: true }, { is_stale: true }] });
    expect(state).toEqual({ tone: "warning", title: "Event AVL positions are stale.", action: "Live positions remain visible but do not support reporting-now claims." });
  });

  it("reports No results for a successful empty scoped response", () => {
    const state = deriveEventMonitoringDataState({ ...base, hasOperatingContext: true, activePlanCount: 1, health: {}, vehicles: [] });
    expect(state.tone).toBe("warning");
    expect(state.title).toBe("No active vehicles are reporting.");
  });
});
