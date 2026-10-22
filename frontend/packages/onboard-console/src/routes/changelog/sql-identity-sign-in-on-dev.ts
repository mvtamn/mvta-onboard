import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.21",
  date: "2026-10-21",
  sections: [
    {
      heading: "Changed",
      items: [
        "On dev, the OnBoard services now sign in to the database with their own Azure identity instead of the shared database password. Production still uses the password until dev has run cleanly this way. Nothing changes for staff or riders.",
      ],
    },
  ],
};

export default entry;
