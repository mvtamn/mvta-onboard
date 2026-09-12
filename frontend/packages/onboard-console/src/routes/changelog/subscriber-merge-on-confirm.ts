import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.193",
  date: "2026-09-11",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Someone who signed up twice with the same number or email would have received every alert twice, once per record. Duplicate records are now folded together at the moment the contact is confirmed, keeping the older record and combining the alert types and routes chosen on both.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "The Subscribers page no longer counts a folded-away record as a separate subscriber.",
      ],
    },
  ],
};

export default entry;
