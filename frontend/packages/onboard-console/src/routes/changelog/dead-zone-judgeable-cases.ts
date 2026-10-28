import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.38",
  date: "2026-10-27",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A missed-trip case's first-stop record now counts only the no-shows the evidence could judge. Retired cases, and ones raised while the vehicle feed was down, show no start because of the feed rather than the stop, and they were hiding real GPS dead zones: Savage Park & Ride read 38 of 82 run, though every one of its cases since the September guards had run.",
      ],
    },
  ],
};

export default entry;
