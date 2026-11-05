import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.46",
  date: "2026-11-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "Production's OnBoard services now sign in to the database with their own Azure identity instead of the shared database password, as dev has since 1.7.25. Nothing changes for staff or riders.",
      ],
    },
  ],
};

export default entry;
