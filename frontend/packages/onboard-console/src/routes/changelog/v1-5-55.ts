import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.55",
  date: "2026-08-22",
  sections: [
    {
      heading: "Changed",
      items: [
        "Open Event notifications are a count badge in the Event AVL context bar that opens a queue drawer, rather than a panel above the map. This replaces the arrangement described in 1.5.47: the work waiting on you stays visible from every scroll position without the map losing the first viewport. Pending, acknowledged, and failed notifications all remain in the open queue, so a failed delivery is still retryable.",
      ],
    },
  ],
};

export default entry;
