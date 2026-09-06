import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.125",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Subscribers page in Administration opens again when there are no subscribers yet. It showed the \"try this view again\" screen because the counts arrived empty instead of as zeros.",
      ],
    },
  ],
};

export default entry;
