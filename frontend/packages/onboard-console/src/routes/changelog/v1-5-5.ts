import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.5",
  date: "2026-08-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips: the flagged-trip list is now a proper table, and identifies each trip the way Avail's own reports do - by scheduled time and direction, like \"1245-SB\" - instead of an opaque internal key like \"t52C-b2E-sl2B-v62\". There's a new Direction column (NB/SB/EB/WB), and the raw reference is still in the detail panel if support needs it.",
      ],
    },
  ],
};

export default entry;
