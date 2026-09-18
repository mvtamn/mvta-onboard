import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.260",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips' list and its tiles are now guaranteed to count the same cases. Both come from one place in the Missed-trip case module rather than from two queries written out inside the endpoints, and a database test proves each view lists exactly what its tile claims.",
        "The Monthly Assessments rollup reads the same definition of a finding as the review queue, instead of restating it.",
      ],
    },
  ],
};

export default entry;
