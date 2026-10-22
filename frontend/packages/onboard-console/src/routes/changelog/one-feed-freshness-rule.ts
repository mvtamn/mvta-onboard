import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.36",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Integrations & Data Health judges every feed by the same freshness rule. The Prediction capture row now reads Stale when the live feed it records stops changing, even if it keeps writing every run, just as the trust cards judge the other feeds.",
      ],
    },
  ],
};

export default entry;
