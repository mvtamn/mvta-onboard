import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.11",
  date: "2026-10-20",
  sections: [
    {
      heading: "Added",
      items: [
        "Each night OnBoard scores the arrival predictions riders saw the day before, the way Swiftly and Transit publish it: how often the bus came within the window around the predicted time, at 0-3, 3-6, 6-10 and 10-15 minutes away. The scores are kept per route, direction, hour and stop. The page that shows them comes next.",
        "Integrations & Data Health shows a Prediction accuracy scoring row, so a night that did not score is visible.",
      ],
    },
  ],
};

export default entry;
