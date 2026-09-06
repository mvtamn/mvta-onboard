import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.43",
  date: "2026-08-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event Planning now rejects self-intersecting geofence polygons before save, restores the previous boundary after an invalid edit, and keeps the map available for another attempt.",
      ],
    },
  ],
};

export default entry;
