import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.335",
  date: "2026-10-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "When the prediction capture is not allowed to write to its storage, the Prediction capture row on Integrations & Data Health now says so and names the missing permission. The capture tries again every 15 minutes instead of failing every 30 seconds.",
      ],
    },
  ],
};

export default entry;
