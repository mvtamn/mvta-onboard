import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.219",
  date: "2026-09-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On Integrations & Data Health, the MVTA Connect missed-trip ingestion rows now use the same 45-minute freshness limit as the trust cards above them. They used to show Stale for ten minutes while the cards said Current.",
        "A feed check row that is not current now says why, using the last failure the feed recorded.",
        "If the hourly MVTA Connect reconciliation fails because no service zones are active, the failure and its reason are now recorded. The On-Demand stream previously went stale with no explanation.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "GTFS-Realtime Alerts and Avail Detours now record each delivery and failure in feed health, so a broken feed no longer looks like a quiet one.",
      ],
    },
  ],
};

export default entry;
