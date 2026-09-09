import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.163",
  date: "2026-09-09",
  sections: [
    {
      heading: "Changed",
      items: [
        "Performance Assessment opens on one card for the contractor and month. The contractor picker, the month stepper and the status pill replace the context bar, the \"Open assessment month\" button and the separate Assessment period select, which named the same month twice. Beneath them the card shows where the month is in its lifecycle (Opened, Computed, In review, Validation, Finalized, Issued), the proposed and recommended totals, and an Outstanding list — items awaiting review, monthly figures missing, occurrences needing an amount, CAPs flagged — each a link into the section where it is dealt with. One button names the next thing the month needs: opening it, computing, continuing review, preparing the draft, finalizing or issuing, the same actions the section pages already allow at that status.",
        "Stepping to a month with no assessment shows it as Not opened, with opening it as the action. A correction period is shown in place of the one it supersedes.",
        "The module's own title block and the four stat tiles are gone; the card carries the figures, and the page header already names the page. The card is drawn on the console's theme tokens, so it follows the dark theme.",
      ],
    },
  ],
};

export default entry;
