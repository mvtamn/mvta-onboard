import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.59",
  date: "2026-11-01",
  sections: [
    {
      heading: "Added",
      items: [
        "Missed-trip Detectors has a GPS dead zones panel: every first stop with its judged no-shows and how many ran, and the bar that marks a stop as a likely dead zone. Moving the bar shows which stops it would add or drop before you save. Once migration 155 is applied, admins with Service Configuration access can change it.",
      ],
    },
  ],
};

export default entry;
