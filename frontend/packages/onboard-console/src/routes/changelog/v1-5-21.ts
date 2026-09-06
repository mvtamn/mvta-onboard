import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.21",
  date: "2026-08-12",
  sections: [
    {
      heading: "Changed",
      items: [
        "Event AVL now defaults to the most relevant Event context and clearly identifies missing or inactive operating scope.",
        "Event Workspace navigation now links Configure to Event Configuration and states the route-readiness requirement explicitly.",
      ],
    },
  ],
};

export default entry;
