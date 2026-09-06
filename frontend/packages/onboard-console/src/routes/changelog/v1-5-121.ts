import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.121",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage Departures (On-Demand) now reads like the Fixed Route view: duties grouped by service day, driver, or vehicle, a Flagged-only filter, a per-day strip, dates as weekday and date, Central times with where each time came from underneath, and Spare driver ids shown as short references with the full id on hover.",
        "On-Demand duties are judged the way the compliance candidate rule judges them, once their service day is over; today's duties are marked Not settled, and cancelled duties are left out of the counts.",
      ],
    },
  ],
};

export default entry;
