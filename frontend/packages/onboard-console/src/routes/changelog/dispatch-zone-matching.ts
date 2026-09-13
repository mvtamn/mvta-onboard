import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.199",
  date: "2026-09-12",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A service alert scoped to an MVTA Connect zone now goes only to riders who chose that zone, or chose all zones, instead of to everyone.",
      ],
    },
  ],
};

export default entry;
