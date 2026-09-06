import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.74",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Garage-departure occurrences now cover the runs that never left the garage. The rule was looking for a status the feed never sends, and missed more than four hundred runs with no recorded departure. Statuses describing a bus returning to the garage can no longer be counted as departure failures, and a run the source has not finished classifying is left alone.",
      ],
    },
  ],
};

export default entry;
