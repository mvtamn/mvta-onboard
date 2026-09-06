import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.38",
  date: "2026-08-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event AVL now projects every fresh AVL vehicle so vehicles outside active service-plan scope populate the unassigned queue.",
      ],
    },
  ],
};

export default entry;
