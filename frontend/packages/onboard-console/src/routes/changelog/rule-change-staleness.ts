import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.163",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Changing the rules now reaches the month being assessed. Assign a standard to an Agreement, edit a penalty band, or retire a standard while a month is open, and until now that month could never score the change: recompute read the rule set the period snapshotted when it opened, and reopening copied the same old snapshot forward. The only remedy was deleting the period by hand. A period that has not been finalised now rebuilds its rule set when it recomputes.",
        "A rule change also says so. Only measurement changes — a logged occurrence, a manual figure, added evidence — used to mark a period stale, so after a rules edit the period went on reading as current and correct while what it would score had changed. Rule changes now mark every still-drafting period stale and record why, which is what puts Recompute in front of the reviewer.",
        "A finalised or issued month is untouched by both. Its figure was agreed under the rules of its own time, and it keeps the snapshot it was finalised with — as does a reopened month, which exists to correct a figure rather than to rewrite the rules behind it.",
      ],
    },
  ],
};

export default entry;
