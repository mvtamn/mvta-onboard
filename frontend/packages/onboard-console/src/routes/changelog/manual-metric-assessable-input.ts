import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.241",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Entering or changing a hand-entered monthly figure for a finalized or issued month is refused, with a sentence saying to reopen the period. The Assessment module already hid the form for those months, but a page left open, or a direct call, could still store a figure and mark the month changed.",
        "Changing a figure for a month already shared for validation now withdraws the share and voids the live issuance proof, as every other change to a shared month does. Before, the month was marked changed silently and the contractor kept reviewing figures that had moved.",
      ],
    },
  ],
};

export default entry;
