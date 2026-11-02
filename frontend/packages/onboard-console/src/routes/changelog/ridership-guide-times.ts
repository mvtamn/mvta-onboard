import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.72",
  date: "2026-11-01",
  sections: [
    {
      heading: "Changed",
      items: [
        "Count Sheets name each trip the way the paper sheet and the Access form do: by its scheduled times, such as 5:20 AM – 6:40 AM, with the route and a one-letter direction (E, W, N, S). The long GTFS trip ID now sits in small type underneath.",
        "Times show with AM and PM on the Ridership page, on Print sheets and on the printed Count Sheet.",
        "An unscheduled trip's start can be typed as 7:30 PM as well as 19:30. On paper, the start time has AM and PM to circle.",
      ],
    },
  ],
};

export default entry;
