import { describe, expect, it } from "vitest";
import type { EventVehiclePosition } from "@mvta/shared";
import { monitoringAreaLabel, routeVehicleLabel } from "./eventVehicleFormat.js";

function vehicle(overrides: Partial<EventVehiclePosition> = {}): EventVehiclePosition {
  return {
    vehicle_id: 4834, route: 5555, route_label: null, route_category: "SpecialEvent",
    latitude: 44.9, longitude: -93.2, heading: 0, direction: null, block: null, run: null,
    operator_name: null, service_plan_names: [], service_plan_ids: [], speed_mph: null,
    report_timestamp: "2026-08-24T16:00:00.000Z", updated_at: "2026-08-24T16:00:00.000Z",
    report_age_seconds: 0, is_stale: false, is_in_active_scope: false,
    zone_id: null, zone_name: null, zone_purpose: null, zone_status: "Outside monitored zones",
    ...overrides,
  };
}

describe("Event AVL vehicle labels", () => {
  it("names the route and vehicle without repeating a missing Monitoring Area fallback", () => {
    const row = vehicle();

    expect(routeVehicleLabel(row)).toBe("Route 5555 (Vehicle 4834)");
    expect(monitoringAreaLabel(row)).toBe("Outside monitored zones");
  });

  it("keeps a distinct Monitoring Area name when one is available", () => {
    expect(monitoringAreaLabel(vehicle({ zone_status: "In zone", zone_name: "State Fair Transit Hub" })))
      .toBe("In zone · State Fair Transit Hub");
  });
});
