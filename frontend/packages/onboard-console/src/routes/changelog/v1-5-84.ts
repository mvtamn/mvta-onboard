import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.84",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Detour Intake list no longer fails on an environment that is missing one of its optional migrations; it omits those columns instead.",
      ],
    },
  ],
};

export default entry;
