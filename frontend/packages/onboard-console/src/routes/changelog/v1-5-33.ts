import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.33",
  date: "2026-08-14",
  sections: [
    {
      heading: "Changed",
      items: [
        "Event geofence notifications now include the bus number explicitly.",
        "Event Planning now distinguishes operational-only geofences from messaging-enabled geofences while activating them in one operating period.",
      ],
    },
  ],
};

export default entry;
