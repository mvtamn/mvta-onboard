import { describe, expect, it } from "vitest";
import { occurrenceSourceLabel } from "./occurrenceSource";

describe("occurrenceSourceLabel", () => {
  it("names the module a reviewer should open, and what to find there", () => {
    expect(occurrenceSourceLabel({ kind: "missed_trip", system: "gtfs", record_id: "4401", service_date: "20260712" }))
      .toEqual({ module: "Missed Trips", reference: "Trip 4401 · 07/12/2026", to: "/compliance" });
    expect(occurrenceSourceLabel({ kind: "missed_trip", system: "spare", record_id: "req-9", service_date: "20260712" })?.module)
      .toBe("Missed Trips · On-Demand");
    expect(occurrenceSourceLabel({ kind: "fixed_route_departure", service_date: "20260904", block: "1305", run: "2" }))
      .toEqual({ module: "Garage Departures · Fixed Route", reference: "Block 1305/2 · 09/04/2026", to: "/compliance" });
    expect(occurrenceSourceLabel({ kind: "on_demand_departure", duty_id: "duty-1" }))
      .toEqual({ module: "Garage Departures · On-Demand", reference: "Duty duty-1", to: "/compliance" });
  });

  it("has nothing to say about a hand-entered occurrence", () => {
    // Including against a server that predates the parsed field, where the
    // occurrence log falls back to "Entered by hand".
    expect(occurrenceSourceLabel(null)).toBeNull();
    expect(occurrenceSourceLabel(undefined)).toBeNull();
  });
});
