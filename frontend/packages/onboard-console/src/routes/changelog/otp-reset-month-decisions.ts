import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.321",
  date: "2026-10-15",
  sections: [
    {
      heading: "Added",
      items: [
        "OTP Review Queue: a \"Reset decisions\" button clears every stop exclusion decision for the month you are viewing, so each flagged stop goes back to pending. It asks you to confirm first. Weather days and finalized assessments are not affected.",
      ],
    },
  ],
};

export default entry;
