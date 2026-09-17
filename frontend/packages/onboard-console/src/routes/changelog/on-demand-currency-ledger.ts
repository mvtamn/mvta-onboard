import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.228",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand service quality and Integrations & Data Health now always agree on whether MVTA Connect data is current. Each used to read its own record of the hourly check, and the two could briefly disagree after a failed check.",
        "Automatic On-Demand alert drafts follow that same status, so a draft is never prepared from data the service quality page is showing as out of date.",
      ],
    },
  ],
};

export default entry;
