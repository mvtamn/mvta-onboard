import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.135",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Garage Departures, On-Demand: grouping by operator or vehicle no longer prints Spare's full 36-character id beside the driver's name or the fleet number. The short reference shows instead, with the full id on hover.",
      ],
    },
  ],
};

export default entry;
