import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.214",
  date: "2026-09-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The hourly On-Demand reconciliation asked MVTA Connect for its entire trip history every time it ran. On real data it would have hit its own safety limit among records from years ago and stopped before reaching today - an hourly failure that would have looked like a problem at Spare. It now asks only for what has changed in the last day, the same way the Missed Trips feed already does.",
      ],
    },
  ],
};

export default entry;
