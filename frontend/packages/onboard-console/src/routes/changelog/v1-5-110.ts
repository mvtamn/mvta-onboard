import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.110",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Spare webhook receiver now protects the rest of OnBoard: it limits how much database work deliveries can hold at once, refuses new deliveries briefly after a failure instead of queueing them, and records repeated vehicle sightings for a duty once a minute. Service Risk & Quality data is unchanged.",
      ],
    },
  ],
};

export default entry;
