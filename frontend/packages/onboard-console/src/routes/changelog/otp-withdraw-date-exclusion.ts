import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.316",
  date: "2026-10-08",
  sections: [
    {
      heading: "Added",
      items: [
        "An approved weather day can be withdrawn. Since the September release an approved date genuinely subtracts its departures from Official Departure OTP — and nothing could undo it. The page offered Add and Approve, and that was all: no reject, no remove, no un-approve. A date approved by mistake, on the wrong day or the wrong route scope, permanently inflated that month's figure, and the only way back was a hand edit against the database.",
        "Withdrawing is not deleting. The row stays, and so does the frozen record of exactly which departures it took out — a dispute is about what was removed and who decided it, so the evidence has to survive. The date simply stops subtracting, and the Weather page shows it as Withdrawn with who did it and why.",
        "It asks why before it acts. A withdrawal moves a published figure, so it takes a stated reason rather than one click, and a Compliance reviewer's permission — the same one that approves.",
      ],
    },
  ],
};

export default entry;
