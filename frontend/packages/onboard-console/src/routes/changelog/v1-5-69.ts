import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.69",
  date: "2026-08-28",
  sections: [
    {
      heading: "Changed",
      items: [
        "An On-Demand request that is neither overdue nor forecast past its standard now reads \"Within standard\" instead of Watch, so the Watch label carries one meaning.",
        "The Fixed Route and On-Demand workspaces now share one training-scenario toggle, actions-unavailable rule, and stale-data acknowledgement prompt, and KPI trust states read identically in the Admin feed-health view.",
      ],
    },
  ],
};

export default entry;
