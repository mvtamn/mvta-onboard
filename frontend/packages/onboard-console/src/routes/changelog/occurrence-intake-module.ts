import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.239",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "An issued or finalized assessment month is no longer changed by anything logged or reviewed afterwards. Reviewing a missed trip, dismissing an occurrence or recording a penalty amount for that month is refused with a sentence saying to reopen the period.",
        "Occurrences are assigned to the contractor whose active Performance Agreement covers the service date. If no Agreement or more than one covers it, nothing is added to an assessment, instead of picking the contractor edited most recently.",
        "An occurrence is added only for a standard the Agreement scores on that date.",
        "Changing an occurrence in a month already shared for validation withdraws the share, as other changes to a shared month do.",
      ],
    },
  ],
};

export default entry;
