import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.41",
  date: "2026-11-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Missed Trips no longer escalates a bus that left on time just because the feed had predicted its departure to the second. The Dispatch Log's departure was thrown out whenever it matched the last prediction, which is the normal case for a bus that leaves when expected. Eleven open cases on dev, from 22 September to 3 November, were buses that left inside the 30 minutes; they close on the detector's next pass.",
      ],
    },
  ],
};

export default entry;
