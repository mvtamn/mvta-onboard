import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.128",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Internal: release notes are now written one file per release instead of one shared list, so two people preparing releases at the same time no longer have to untangle each other's entries before either can ship.",
      ],
    },
  ],
};

export default entry;
