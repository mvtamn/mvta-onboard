import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.143",
  date: "2026-09-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand draft alerts now arrive while the trip they describe is still running. A customer wait past its service standard raised a Suggested Alert only when the hourly reconciliation next ran — up to an hour later, and up to two hours for a wait that was forecast to breach rather than already past it, against a standard of twenty-five minutes. The check now runs every five minutes.",
        "A wait that recovers before anyone reviews it is now closed within minutes rather than at the next hour, so the queue stops holding drafts about trips that resolved themselves.",
      ],
    },
  ],
};

export default entry;
