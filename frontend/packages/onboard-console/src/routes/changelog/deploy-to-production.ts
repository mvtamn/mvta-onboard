import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.323",
  date: "2026-10-15",
  sections: [
    {
      heading: "Changed",
      items: [
        "Behind the scenes, OnBoard can now be deployed to a production environment as well as dev. Nothing changes for staff yet: dev is still the only live environment, and merges still deploy to it automatically. Production will only ever be deployed on purpose, by someone approving it.",
      ],
    },
  ],
};

export default entry;
