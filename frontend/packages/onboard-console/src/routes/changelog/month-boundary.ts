import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.174",
  date: "2026-09-09",
  sections: [
    {
      heading: "Added",
      items: [
        "On the first of each month, at 06:00 UTC (midnight or 1 a.m. Central, depending on the season), OnBoard can open the new assessment month, open the month that just ended if nobody did, compute it if nobody has reviewed it, and generate its Validation Draft — unless the month still has unreviewed candidate occurrences, in which case the draft waits for the review — and then stop. It shares nothing, issues nothing, and tells no one; a manager still acts. A month someone has already reviewed is never recomputed by the clock. Off unless switched on for the environment, so a deployment where the compute or the report is not yet trusted keeps doing this by hand.",
      ],
    },
  ],
};

export default entry;
