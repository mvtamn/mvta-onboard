import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.174",
  date: "2026-09-09",
  sections: [
    {
      heading: "Added",
      items: [
        "On the first of each month, an hour after midnight Central, OnBoard can open the new assessment month, open the month that just ended if nobody did, compute it if nobody has reviewed it, and generate its Validation Draft — and then stop. It shares nothing, issues nothing, and tells no one; a manager still acts. A month someone has already reviewed is never recomputed by the clock. Off unless switched on for the environment, so a deployment where the compute or the report is not yet trusted keeps doing this by hand.",
      ],
    },
  ],
};

export default entry;
