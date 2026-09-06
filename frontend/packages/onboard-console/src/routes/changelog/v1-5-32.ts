import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.32",
  date: "2026-08-13",
  sections: [
    {
      heading: "Changed",
      items: [
        "The sidebar now presents the running version as a distinct badge with a clearer What’s new action.",
        "Release notes now open the exact running build, restore missing releases 1.5.8 through 1.5.31, and make the full history easier to scan with expandable releases.",
      ],
    },
  ],
};

export default entry;
