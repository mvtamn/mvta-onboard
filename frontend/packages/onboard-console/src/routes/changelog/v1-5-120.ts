import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.120",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage Departures (Fixed Route) now judges every run the way the compliance candidate rule does and shows that Outcome beside Avail's status; the cards count no-departure and late-over-allowance runs on settled days only, and today's runs are marked Not settled.",
        "Fixed Route rows are grouped by service day, operator, or vehicle, with a Reviewable-only filter and a per-day strip of reviewable departures. Dates read as weekday and date, times are Central, operators show as a name with their badge, and blanks say what is missing.",
      ],
    },
  ],
};

export default entry;
