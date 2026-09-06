import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.20",
  date: "2026-08-12",
  sections: [
    {
      heading: "Changed",
      items: [
        "Event Planning now shows planned resources before review and activation controls and explains when validated scope reaches Event AVL.",
        "Event AVL map cleanup now tolerates already-removed resources so navigation cannot blank the console.",
      ],
    },
  ],
};

export default entry;
