import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.256",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Missed Trips reports a detector as running when it is running. Whether GTFS silent-no-show detection and the Spare pipeline are on was worked out separately in five places, each re-reading the same environment variables, so the page and the poll could disagree without anything failing. They now all ask the Missed-trip case module.",
        "\"Spare service scope configured\" no longer reads as configured when the scope is a list of nothing but commas.",
      ],
    },
  ],
};

export default entry;
