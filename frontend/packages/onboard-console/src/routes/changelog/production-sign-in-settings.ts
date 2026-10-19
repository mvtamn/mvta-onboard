import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.336",
  date: "2026-10-16",
  sections: [
    {
      heading: "Changed",
      items: [
        "Behind the scenes, production now has its own sign-in registration, separate from dev's, so a sign-in to dev is never accepted by production. Nothing changes for staff on dev.",
      ],
    },
  ],
};

export default entry;
