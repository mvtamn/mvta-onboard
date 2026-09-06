import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.95",
  date: "2026-09-04",
  sections: [
    {
      heading: "Added",
      items: [
        "Likely-duplicate and conflict warnings now recognise two Detours that touch the same GTFS stop, from the map drawing or the stops added from it, and name the shared stops.",
      ],
    },
  ],
};

export default entry;
