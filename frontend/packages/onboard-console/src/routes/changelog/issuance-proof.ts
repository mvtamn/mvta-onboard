import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.161",
  date: "2026-09-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Generating a final report no longer creates a Final Assessment. What the button made was the render an Issuing Authority checks before issuing — archived and hashed, but never sent — and it had no name, so the console called it a Final and the server treated each unissued one as the latest Final the next had to supersede. It is now an Issuance Proof: one live proof per month, preparing another voids the last (kept, struck through in the history, its version number intact), and only Issue creates a Final Assessment. Issuing keeps the proof's hash beside the issued one, so what was checked and what was sent are both on record.",
        "Which Final Assessment a corrected month supersedes is worked out from the month itself, not typed in. A month reopened after issuance corrects the Final that month issued; preparing its proof asks for the reason, which prints on the cover and cannot change at issue. A month that corrects nothing cannot carry a reason.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A month can no longer finalize with fewer Assessment Items than its frozen rule set has standards. A partial compute, or one that ran before a standard was added to the Agreement, used to pass the empty-month check as long as one row existed.",
        "Two people preparing or issuing the same month at once no longer race: each month's report operations take a lock, so the second waits and then sees the first's result instead of colliding on the version number after both blobs were written.",
      ],
    },
  ],
};

export default entry;
