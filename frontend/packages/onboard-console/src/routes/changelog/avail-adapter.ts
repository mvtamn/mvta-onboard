import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.220",
  date: "2026-09-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Avail connection checks on Integrations & Data Health now send exactly the request each Avail feed sends, so a passing check means that feed can connect.",
        "A failing Avail check now shows Avail's own error message, not just a status code.",
        "A slow or unresponsive Avail response now gives up after 30 seconds and is recorded as a failure, instead of holding up other background work.",
      ],
    },
  ],
};

export default entry;
