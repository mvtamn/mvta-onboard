import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.30",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Dispatch Log no longer records a bus as leaving when it has only pulled into its first station. For a moment as a bus arrives, the realtime feed reports the arrival as the departure, then goes back to the scheduled time. The log kept that first reading, so about 2,300 trips from September 21 to October 21 (mostly routes 444, 445, 436 and 446) showed as leaving about 15 minutes early and counted as on time. When the feed takes the departure back, the log now does too, and records the real departure once it happens.",
        "Route 495's late-night trip no longer takes its start from the previous night's run. The feed reuses trip ids every day, and a trip still running after midnight was being matched to the next day's trip with the same id, which logged it about 23 hours early.",
      ],
    },
  ],
};

export default entry;
