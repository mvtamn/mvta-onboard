import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.269",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Missed Trips shows when two sources disagree about a run. The case is flagged in the list and explains itself on the detail: what disagreed, and what you are being asked to do about it.",
        "Recording a review settles the disagreement — that is what having both sources in front of you means — and the trip becomes eligible for the performance assessment again.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A trip held out of the performance assessment because its sources disagree no longer reads as \"Counted\" in that month. It says it is held, and why.",
      ],
    },
  ],
};

export default entry;
