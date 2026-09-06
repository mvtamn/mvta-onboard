import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.3.0",
  date: "2026-07-28",
  sections: [
    {
      heading: "Added",
      items: [
        "Missed-trip detection as a compliance investigation tool: explicit GTFS-RT cancellations and schedule-based silent no-shows are flagged into a new Missed Trips module for staff to investigate and validate (confirmed / false positive) - deliberately decoupled from the Suggested Alerts customer-notification queue, since a flagged trip is a compliance record, not an automatic rider alert.",
        "Suggested Alerts now auto-expire to “expired” after 2 hours unreviewed, across every detection source.",
      ],
    },
  ],
};

export default entry;
