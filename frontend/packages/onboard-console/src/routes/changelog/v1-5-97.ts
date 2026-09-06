import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.97",
  date: "2026-09-05",
  sections: [
    {
      heading: "Added",
      items: [
        "Dispatch Log groundwork: a nightly trip-start log is now built for today and tomorrow from the GTFS schedule, with each trip's weekly verification-rotation day, and can be read per service date. Actual start times and the console module follow in later steps.",
      ],
    },
  ],
};

export default entry;
