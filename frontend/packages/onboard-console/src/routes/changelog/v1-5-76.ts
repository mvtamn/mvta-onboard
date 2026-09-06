import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.76",
  date: "2026-09-03",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Detour Intake reports returned for information no longer disappear. They appear under a Needs information tab with OCC's request, can be updated and resubmitted for review, and can still be withdrawn, rejected, or marked duplicate. Pending reports can be edited in place, and decided reports are listed with their outcome.",
      ],
    },
  ],
};

export default entry;
