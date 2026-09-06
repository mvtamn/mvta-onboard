import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.14",
  date: "2026-08-10",
  sections: [
    {
      heading: "Added",
      items: [
        "Event Monitoring now records 90-day telemetry diagnostics, component health, and retention-cleanup status for shared AVL ingestion, event projection, and crossing detection.",
        "Live event vehicles now show their active Service Plan scope, and secondary crossing, notification, and audit feeds retain their last successful data while reporting failures.",
        "Route classifications now validate local effective-date ranges, preserve prior versions, and reject stale edits; geofence updates validate geometry and reject conflicting edits.",
      ],
    },
  ],
};

export default entry;
