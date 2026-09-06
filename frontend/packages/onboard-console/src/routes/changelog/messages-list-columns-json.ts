import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.128",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Older messages now store their channels, tags and route lists in the same format as new ones, so every screen that lists messages reads them the same way. Nothing changes in what you see.",
      ],
    },
  ],
};

export default entry;
