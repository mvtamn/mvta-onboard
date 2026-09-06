import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.62",
  date: "2026-08-24",
  sections: [
    {
      heading: "Improved",
      items: [
        "Every detected Monitoring Area entry or exit now creates a Status queue item; unmatched crossings stay available for manual review and cannot auto-send to Teams.",
        "Event AVL vehicle identity now leads with the display label, for example State Fair Shuttle: Route 444 (Vehicle 4522), including vehicle views, map popups, crossing history, and new queue messages.",
      ],
    },
  ],
};

export default entry;
