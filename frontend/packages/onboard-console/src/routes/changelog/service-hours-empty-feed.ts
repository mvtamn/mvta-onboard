import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.209",
  date: "2026-09-14",
  sections: [
    {
      heading: "Changed",
      items: [
        "Service Risk now warns when the fixed-route feed reports no trips during service hours. Between 4am and 10pm Central, fixed-route trips are always running, so an empty page at that hour means the feed is sending nothing or trips are not being monitored. The page previously showed the same calm \"No active trips\" banner it shows overnight.",
        "The warning says which it is: the feed sending no trips, or the feed sending trips that are not being monitored. Overnight, an empty feed still shows as a quiet night.",
      ],
    },
  ],
};

export default entry;
