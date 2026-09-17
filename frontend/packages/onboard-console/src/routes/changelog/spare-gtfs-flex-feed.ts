import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.236",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "MVTA Connect zone boundaries now come straight from Spare every morning. There is no longer an archive to export and upload on Zone geometry.",
        "Zone geometry shows when Spare's feed was last checked, whether that worked, and when it will next be checked.",
        "A service area Spare publishes that MVTA does not monitor is listed on Zone geometry, so a new area is not missed.",
        "A new set of zones only appears for activation when the zone boundaries or names actually change, not every time Spare re-exports the same zones.",
      ],
    },
  ],
};

export default entry;
