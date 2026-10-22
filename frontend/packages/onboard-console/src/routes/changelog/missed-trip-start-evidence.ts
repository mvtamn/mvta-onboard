import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.27",
  date: "2026-10-22",
  sections: [
    {
      heading: "Added",
      items: [
        "A fixed-route missed-trip case now shows its start evidence: when the trip started and how late, whether that was inside the 30 minutes, the Dispatch Log's departure time (or why the time it holds is not a departure), whether a bus reported on the trip, how many of the block's trips had a bus, and how the other no-shows at the trip's first stop turned out.",
        "A first stop where most earlier no-shows turned out to have run is marked as a likely GPS dead zone, so a reviewer knows the silence may be the stop and not the trip.",
      ],
    },
  ],
};

export default entry;
