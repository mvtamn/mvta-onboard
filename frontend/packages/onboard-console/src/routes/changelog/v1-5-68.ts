import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.68",
  date: "2026-08-28",
  sections: [
    {
      heading: "Changed",
      items: [
        "On-Demand records are now named requests rather than trips, in both the workspace labels and the underlying data contract, matching the Active on-demand request terminology.",
      ],
    },
  ],
};

export default entry;
