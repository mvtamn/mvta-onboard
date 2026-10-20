import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.328",
  date: "2026-10-16",
  sections: [
    {
      heading: "Added",
      items: [
        "Schedule Review now says what changed since the last review: which routes gained or lost a flag, with the figure before and after, and which routes entered or left the feed. Pick any earlier review to compare with, and open a route straight from the list.",
        "It tells a new schedule apart from a change in how the schedule is checked. On the current feed, the only change is route 470 now flagged for stop-free miles, because distance is measured along I-35W (16 miles) rather than as the crow flies (9.6). The page says the schedule itself did not change.",
        "Integrations & Data Health shows the same headline as one line, linking to it.",
      ],
    },
  ],
};

export default entry;
