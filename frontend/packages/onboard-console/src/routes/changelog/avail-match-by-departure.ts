import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.62",
  date: "2026-11-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Avail's missed-trip report is now matched to the trip that actually left at the time it gives. Avail's start time is when the bus left, not when it was scheduled to, so a record for a bus that left a few minutes late used to match nothing, and could even be attached to a different missed trip scheduled at that minute. Each record now names the trip it points at, and a missed-trip case only takes Avail's evidence when that trip is the case's own.",
      ],
    },
  ],
};

export default entry;
