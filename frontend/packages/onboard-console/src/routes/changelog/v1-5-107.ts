import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.107",
  date: "2026-09-05",
  sections: [
    {
      heading: "Added",
      items: [
        "Dispatch Log verifications can now be recorded: the SST OCS desk initials a trip's start from the Grid cell, the Watch queue, or the inspector, records a disposition with a note where a trip ran late, and can correct or clear an entry. Every change is kept in an audit trail.",
      ],
    },
  ],
};

export default entry;
