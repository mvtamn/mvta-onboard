import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.233",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A slow or unresponsive GTFS-Realtime feed now gives up after 30 seconds and is recorded as a failure, instead of holding up other background work.",
        "On Integrations & Data Health, a GTFS-Realtime feed with no address set now shows as Not configured rather than Failed.",
      ],
    },
  ],
};

export default entry;
