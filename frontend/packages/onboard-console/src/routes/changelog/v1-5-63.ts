import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.63",
  date: "2026-08-27",
  sections: [
    {
      heading: "Improved",
      items: [
        "Event AVL Status queue delivery now uses a short-lived claim, preventing concurrent operator and retry deliveries from posting the same Teams notification twice.",
        "The queue shows an in-progress delivery and keeps pending, acknowledged, in-progress, and failed work in the operational count until it reaches a terminal outcome.",
      ],
    },
  ],
};

export default entry;
