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
        "The 675 review-queue items raised from runs Avail never scheduled have been dismissed. They were the bulk of the garage-departure queue, and a month cannot be finalised while any of them sits unreviewed. Each keeps its evidence and can be re-confirmed.",
        "One of those had already been reviewed and charged to the contractor, so it was left alone rather than overridden — block 1119 on 31 August. It is worth reopening.",
      ],
    },
  ],
};

export default entry;
