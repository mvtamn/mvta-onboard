import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.67",
  date: "2026-08-27",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A feed run that completed successfully with no qualifying records now reports as covered rather than unavailable, so a quiet period no longer blocks preparing a customer update.",
      ],
    },
  ],
};

export default entry;
