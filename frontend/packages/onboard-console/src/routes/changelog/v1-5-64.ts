import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.64",
  date: "2026-08-27",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand KPI trust is now established by the hourly authoritative reconciliation, so it no longer depends on the separately enabled Spare missed-trip ingestion. Spare Requests and Slots remain supporting evidence.",
        "Preparing a Suggested Alert from a Current-but-empty KPI stream no longer asks for a stale-data reason, which the review endpoint rejected.",
      ],
    },
  ],
};

export default entry;
