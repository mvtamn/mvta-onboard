import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.333",
  date: "2026-10-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The prediction capture no longer reads the realtime feeds at the same second as OnBoard's other feed polls, which had slowed some of its runs past their 30-second slot.",
      ],
    },
  ],
};

export default entry;
