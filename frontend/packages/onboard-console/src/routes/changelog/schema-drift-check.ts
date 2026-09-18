import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.279",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Integrations & Data Health now says when the database is behind the code. A migration that has not been applied shows as a failed check naming what is missing, what it breaks, and which file to run — beside the feed checks, where someone already looks.",
      ],
    },
  ],
};

export default entry;
