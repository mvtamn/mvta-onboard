import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.286",
  date: "2026-09-21",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Every time on Fixed Route Garage Departures was showing five hours early — a 4:41 AM pullout read as 11:41 PM. Avail sends its times as local clock time, and OnBoard had been reading them as UTC. If you have been reading pullout times off this page, they were wrong by five hours.",
        "Early-morning runs were also filed under the wrong day. Anything scheduled between midnight and 5 AM landed on the previous service date, so Monday's first pullouts appeared under Sunday — about two dozen runs a day.",
        "Because those runs sat on the wrong day, the nightly compliance check could not see them until a day later than it should have. That lag is now gone.",
        "Historical departures have been corrected in place, and 547 rows the old reading had stored twice under two different dates were merged back into one.",
      ],
    },
  ],
};

export default entry;
