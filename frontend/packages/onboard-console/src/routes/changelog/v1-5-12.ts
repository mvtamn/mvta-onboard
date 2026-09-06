import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.12",
  date: "2026-08-08",
  sections: [
    {
      heading: "Added",
      items: [
        "Performance Assessment is now a top-level main-menu workspace for contractor-month scorecards, KPI details, occurrence review, manual metrics, manager review, and Attachment G standards.",
        "Confirmed GTFS and Spare missed trips flow into the assessment occurrence log exactly once and require explicit contractor attribution before they affect a monthly assessment.",
        "Assessment calculations are revisioned and hash-audited; finalized report artifacts are stored as verified HTML with governed issuance metadata.",
      ],
    },
  ],
};

export default entry;
