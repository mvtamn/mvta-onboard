import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.127",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Internal: the console's version number now comes from this changelog's newest entry rather than being kept in a second file, so the version shown in the footer and the “What’s new” panel can no longer disagree with the release notes.",
      ],
    },
  ],
};

export default entry;
