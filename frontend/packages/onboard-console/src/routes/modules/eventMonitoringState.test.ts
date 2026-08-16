import { describe, expect, it } from "vitest";
import { activePlansMissingPublishedScope, defaultMonitoringEventId, defaultMonitoringServicePlanId, eventVehiclePositionQuery, isOpenEventNotificationStatus } from "./eventMonitoringState.js";
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

  it("keeps pending, acknowledged, and failed notifications in the open queue", () => {
    expect(["pending", "acknowledged", "failed", "sent", "dismissed"].filter(isOpenEventNotificationStatus)).toEqual(["pending", "acknowledged", "failed"]);
  });
});
