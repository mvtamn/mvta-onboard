import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.70",
  date: "2026-08-28",
  sections: [
    {
      heading: "Changed",
      items: [
        "The shared feed-health ledger behind KPI trust is now named KpiFeedHealth rather than MissedTripFeedHealth, since every KPI stream depends on it.",
      ],
    },
  ],
};

export default entry;
