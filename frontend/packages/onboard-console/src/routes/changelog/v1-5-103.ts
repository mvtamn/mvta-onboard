import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.103",
  date: "2026-09-05",
  sections: [
    {
      heading: "Added",
      items: [
        "Dispatch Log rows now fill in each trip's actual start time from the realtime feed within a minute of departure, with on-time, left-late, late-over-five, missed, and canceled read from it. Trips without realtime coverage still read No actual.",
      ],
    },
  ],
};

export default entry;
