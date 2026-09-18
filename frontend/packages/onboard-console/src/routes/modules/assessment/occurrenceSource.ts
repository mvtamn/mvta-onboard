import type { OccurrenceSource } from "@mvta/shared";
import { formatDate } from "./assessmentFormat.js";

// Which observation an occurrence came from, in words a reviewer can act on:
// which module to open, and what to look for there.
//
// The server parses the stored reference (lib/occurrenceIntake owns its
// format) and sends `observation`, so this only has to put it into words. It
// used to split the raw key here, which meant the console had a second opinion
// about a format it does not own.
export interface OccurrenceSourceLabel {
  module: string;
  reference: string;
  to: string;
}

export function occurrenceSourceLabel(observation: OccurrenceSource | null | undefined): OccurrenceSourceLabel | null {
  if (!observation) return null;
  const to = "/compliance";
  if (observation.kind === "missed_trip") {
    // The source system is worth showing: a Spare case is an on-demand trip,
    // and its record id is a request id rather than a GTFS trip.
    const service = observation.system === "spare" ? "Missed Trips · On-Demand" : "Missed Trips";
    return { module: service, reference: `Trip ${observation.record_id} · ${formatDate(observation.service_date)}`, to };
  }
  if (observation.kind === "fixed_route_departure") {
    return {
      module: "Garage Departures · Fixed Route",
      reference: `Block ${observation.block}/${observation.run} · ${formatDate(observation.service_date)}`,
      to,
    };
  }
  return { module: "Garage Departures · On-Demand", reference: `Duty ${observation.duty_id}`, to };
}
