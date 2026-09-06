import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.2.0",
  date: "2026-07-26",
  sections: [
    {
      heading: "Added",
      items: [
        "Fixed Route Service Risk OCC workspace with exception-first monitoring, future departure predictions, first threshold-crossing departure, confidence evidence, and a stop-by-stop timeline.",
        "On-Demand Service Quality OCC workspace for the 25-minute wait-time standard, including predicted versus actual wait, assignment context, and confidence evidence.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "GTFS TripUpdate processing now treats departures as MVTA's operational measure, retaining predictions for every usable future stop.",
        "Fixed-route escalation now uses the maximum predicted future departure delay across two consecutive polls instead of only the first stop's current delay.",
      ],
    },
  ],
};

export default entry;
