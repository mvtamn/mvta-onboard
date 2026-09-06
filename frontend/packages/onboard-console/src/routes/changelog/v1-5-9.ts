import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.9",
  date: "2026-08-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "AVL Reports now requests its feed window in agency-local time, allowing Event AVL and Route Classification to receive current vehicles.",
      ],
    },
  ],
};

export default entry;
