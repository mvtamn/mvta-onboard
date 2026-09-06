import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.7",
  date: "2026-08-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips: the new Trip/Route/Direction table is now an option rather than a replacement. Use the \"List / Table\" toggle next to Flagged trips - List is the original card layout you were already using, Table is the wider view for scanning many rows. Picking a row in Table mode jumps you into List mode with that trip selected.",
      ],
    },
  ],
};

export default entry;
