import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.13",
  date: "2026-08-09",
  sections: [
    {
      heading: "Added",
      items: [
        "Event Monitoring now includes admin-managed locations, geofences, direction-aware crossings, notification review, audit history, and active Service Plans.",
        "Normal infrastructure redeployments no longer rewrite the Key Vault SQL connection secret; intentional credential rotation is coordinated and restarts the Function Apps.",
      ],
    },
  ],
};

export default entry;
