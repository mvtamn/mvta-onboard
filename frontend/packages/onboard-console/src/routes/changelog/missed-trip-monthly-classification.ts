import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.245",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips' Monthly Assessments table counts what the review actually decided. \"Confirmed missed\" shows how many of those count toward the contractor's assessment, \"False positives\" is now \"Timely service\" — the name the review uses — and partial-service failures and indeterminate reviews have a column of their own instead of disappearing.",
        "\"Unreviewed\" is now \"Awaiting review\", counted from the case's lifecycle rather than from a stored status.",
      ],
    },
  ],
};

export default entry;
