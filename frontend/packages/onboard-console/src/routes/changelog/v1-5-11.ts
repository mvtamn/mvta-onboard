import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.11",
  date: "2026-08-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips now shows 10 candidates by default, with 10, 25, 50, or 100 trips per page and Previous/Next navigation in both List and Table layouts.",
        "The selected-trip investigation panel stays within the viewport and resets to the top when another trip is selected, so reviewers do not need to scroll back up the full queue.",
        "Unreviewed candidates remain human-review items: Aging and Overdue labels communicate urgency without automatically confirming or dismissing a trip.",
      ],
    },
  ],
};

export default entry;
