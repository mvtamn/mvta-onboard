import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.52",
  date: "2026-11-05",
  sections: [
    {
      heading: "Added",
      items: [
        "A fixed-route missed trip's Start evidence now has an \"Avail on-time data\" row. It shows what Avail counted at the trip's first stop in the hour it was due to leave: \"10–11 AM: all 2 scheduled departures from this stop left\" in green, or how many left and how many Avail called missed. Avail counts the hour, not the trip, so the row says every departure that hour left, not that this trip did.",
        "Where Avail recorded nothing for that stop and hour, the row says so. Avail misses departures at some stations, such as Burnsville Center, and its data arrives the next day.",
        "This is evidence for the reviewer only. It never opens, closes or decides a case.",
      ],
    },
  ],
};

export default entry;
