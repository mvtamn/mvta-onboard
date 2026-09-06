import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.47",
  date: "2026-08-20",
  sections: [
    {
      heading: "Improved",
      items: [
        "Event AVL now leads with the open notification queue above the vehicle map, so the work waiting on you comes before the map rather than after it.",
      ],
    },
  ],
};

export default entry;
