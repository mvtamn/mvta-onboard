import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.14",
  date: "2026-10-20",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Access & Identity on production no longer says \"Access Management is unavailable.\" Production now has its own Access Management settings, so the people list, directory search and activity log load there as they do on dev.",
      ],
    },
  ],
};

export default entry;
