import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.246",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "MVTA Connect arrival-time updates from Spare are now looked up only for trips the wait monitor is following, which removes most of the calls back to Spare.",
      ],
    },
  ],
};

export default entry;
