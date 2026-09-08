import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.150",
  date: "2026-09-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Internal: the Dispatch Log's tests no longer break when the calendar reaches the date written into them. Their fixtures described a day a few days in the future, as a fixed date; on 8 September the clock caught up, that day became today, and every assertion that depended on it being ahead of the clock inverted. The fixture day is now derived a week ahead of whenever the tests run. No console change.",
      ],
    },
  ],
};

export default entry;
