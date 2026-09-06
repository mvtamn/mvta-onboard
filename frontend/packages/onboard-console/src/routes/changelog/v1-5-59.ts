import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.59",
  date: "2026-08-24",
  sections: [
    {
      heading: "Improved",
      items: [
        "The larger Event AVL map now expands inside OnBoard and keeps vehicles, selection, Monitoring Areas, locations, traffic, map style, zoom, and compass controls.",
        "Selected vehicle details now lead with a labeled route and vehicle pair, show Monitoring Area context once, and clearly label report freshness.",
        "The focused Event AVL field route now retains the Event AVL page title instead of falling back to Dashboard.",
      ],
    },
  ],
};

export default entry;
