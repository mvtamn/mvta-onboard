import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.267",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "When an Avail record could be about more than one missed-trip case, it is now kept for a reviewer to settle instead of being counted and forgotten overnight. Confirming one names the case, and that is what makes the record back it up.",
        "If Avail stops reporting a record it reported before, the case it was backing up no longer silently keeps the credit — the withdrawal is recorded and brought to a reviewer.",
      ],
    },
  ],
};

export default entry;
