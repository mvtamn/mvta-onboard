import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.35",
  date: "2026-08-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event AVL now loads the shared active-vehicle feed before an Event is selected; selecting an Event still adds plan membership and geofence scope.",
      ],
    },
  ],
};

export default entry;
