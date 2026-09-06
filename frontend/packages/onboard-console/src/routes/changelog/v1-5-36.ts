import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.36",
  date: "2026-08-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Authenticated GET requests now refresh the Entra access token once after a 401 response before showing a feed error.",
      ],
    },
  ],
};

export default entry;
