import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.330",
  date: "2026-10-16",
  sections: [
    {
      heading: "Changed",
      items: [
        "Schedule Review reads each direction on its own when it compares the schedule with what Avail observed. On route 420 it now finds what it missed before: westbound buses leave 157th Street Station 46% late 3–7pm against 4% midday, over a stretch scheduled 20 minutes at every hour.",
        "The morning and afternoon peaks are each compared with midday, and a reading names the peak. The evening no longer counts as off-peak, because lateness there is mostly carried over from the afternoon.",
        "A reading now names the stretch where the lateness is added, not one that only carries it on: the share of late departures has to rise across the stretch itself.",
      ],
    },
  ],
};

export default entry;
