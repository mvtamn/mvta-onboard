import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.152",
  date: "2026-09-08",
  sections: [
    {
      heading: "Added",
      items: [
        "A threshold standard now records the figure the contract states as its target \u2014 85% on time, twelve thousand miles between road calls \u2014 separately from the bands beneath it. Assessment reports print that target where they previously printed the words \u201cConfigured tiers\u201d.",
        "Penalty bands can scale with how many times something happened in the month, so \u201cthe thirteenth and each after it\u201d is expressible. Previously a band was matched against a single occurrence, so a rule written in monthly counts never fired.",
        "A penalty the contract states as a range rather than a figure \u2014 damage reimbursement between \u00a42,500 and \u00a410,000 \u2014 is now recorded as a range, and a reviewer enters the actual amount for each occurrence in the Performance Assessment module, with a note saying what it rests on. Until they do, the occurrence is counted as awaiting an amount rather than scored as nothing.",
        "Corrective action can be required by a rolling window \u2014 more than five preventable collisions in any thirty days, three reporting failures in thirty days. These count across month boundaries, so a run spanning the end of one month and the start of the next is caught, which a per-month rule would miss.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Opening an assessment period would have failed once the reference-lists migration was applied. The snapshot that records a period's penalty bands did not name the columns it was writing, so it depended on their physical order and broke the moment a column was added. Both snapshot paths now name their columns, and the reopen path no longer silently drops the tier ranking.",
      ],
    },
  ],
};

export default entry;
