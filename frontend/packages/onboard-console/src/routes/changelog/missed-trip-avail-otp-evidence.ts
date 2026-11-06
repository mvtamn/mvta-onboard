import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.66",
  date: "2026-11-06",
  sections: [
    {
      heading: "Added",
      items: [
        "A fixed-route missed trip's Start evidence now has an \"Avail on-time data\" row. It shows what Avail counted at the trip's first stop in the hour it was due to leave. It reads \"10–11 AM: all 2 trips scheduled to start here left\" in green when Avail called none of that hour's departures missed and saw enough to cover every trip starting there. Otherwise it gives the counts.",
        "Avail counts the hour, not the trip, so the row says every trip starting there that hour left, not which one. It uses the same rule as the nightly \"departure observed at origin\" check, so the row and the case never disagree.",
        "Where Avail recorded nothing for that stop and hour, the row says so. Avail misses departures at some stations, such as Burnsville Center, and its data arrives the next day. The row is evidence for the reviewer only and never opens, closes or decides a case.",
      ],
    },
  ],
};

export default entry;
