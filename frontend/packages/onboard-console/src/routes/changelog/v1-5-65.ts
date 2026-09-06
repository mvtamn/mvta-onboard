import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.65",
  date: "2026-08-27",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A stale-data acknowledgement is now recorded when a communication is prepared, under the name of the staff member who used the stale data, instead of at approval under the reviewer's name.",
        "An On-Demand request whose pickup commitment has passed now reads as Overdue rather than Watch, keeping an observed condition distinct from a forecast one.",
      ],
    },
  ],
};

export default entry;
