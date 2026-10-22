import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.20",
  date: "2026-10-21",
  sections: [
    {
      heading: "Changed",
      items: [
        "Groundwork for retiring the shared database password. Production's database now has an Entra administrator, and the OnBoard services can sign in to the database with their own Azure identity instead of a password. Nothing switches over yet, so nothing changes for staff or riders.",
      ],
    },
  ],
};

export default entry;
