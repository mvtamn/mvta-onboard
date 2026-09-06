import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.42",
  date: "2026-08-15",
  sections: [
    {
      heading: "Improved",
      items: [
        "Event Planning now supports departing, passed, arriving-soon, and custom geofence message types; Event AVL now controls automatic Teams delivery for the selected active operating period.",
      ],
    },
  ],
};

export default entry;
