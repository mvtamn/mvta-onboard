import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.317",
  date: "2026-10-09",
  sections: [
    {
      heading: "Added",
      items: [
        "A stop exclusion can be changed after it is decided. The API always allowed it — saving a decision upserts in place — but once a stop was approved or rejected the Review Queue showed it as plain text with no controls, so a reviewer who excluded the wrong stop had no way back. Decided rows now offer “Change decision”, which brings back the reason picker with Approve and Reject.",
        "A failed save keeps the buttons up. Closing the row back to a status that had not changed would read as success.",
        "Re-deciding overwrites the earlier decision rather than recording a change of mind. The Review Timeline is derived from the decisions themselves rather than from an audit table, so “approved, then rejected” reads as one entry at the later time. That is a deliberate limitation of the module and is unchanged here; recording a reviewer's change of mind needs a table and a migration.",
      ],
    },
  ],
};

export default entry;
