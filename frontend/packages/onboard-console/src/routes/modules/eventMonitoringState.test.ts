import { describe, expect, it } from "vitest";
import { activePlansMissingPublishedScope, defaultMonitoringEventId } from "./eventMonitoringState.js";
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
  it("prefers an Event with an active operating period", () => {
    expect(defaultMonitoringEventId([event("prepared"), event("active")], [plan("prepared", "approved"), plan("active", "active")])).toBe("active");
  });

  it("falls back to an Event with a prepared period when none is active", () => {
    expect(defaultMonitoringEventId([event("done"), event("prepared")], [plan("done", "completed"), plan("prepared", "approved")])).toBe("prepared");
  });

  it("identifies active plans without a published runtime scope", () => {
    expect(activePlansMissingPublishedScope([plan("missing", "active"), plan("ready", "active", { routes: [], geofences: [], locations: [] })]).map((row) => row.id)).toEqual(["missing-active"]);
  });
});
