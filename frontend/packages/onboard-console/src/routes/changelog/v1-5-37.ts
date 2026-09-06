import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.37",
  date: "2026-08-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event AVL now identifies an expired sign-in and provides a direct Sign in again action instead of remaining in a misleading loading state.",
      ],
    },
  ],
};

export default entry;
