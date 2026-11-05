import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.45",
  date: "2026-11-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Missed Trips no longer reads a bus as an hour late because its clock is. After daylight saving ended on 1 November, some buses kept stamping their positions an hour ahead, so trips that left on time looked as if they started after their 30 minutes and were escalated. A position stamped after OnBoard received it is now recorded at the time it was received, and the positions from 1-3 November are corrected by a one-off repair.",
      ],
    },
  ],
};

export default entry;
