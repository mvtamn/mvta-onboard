import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.224",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Approved is no longer a Detour workflow state anywhere in OnBoard. Accepting a Detour intake is the approval, and a Detour starts awaiting Avail entry or fulfilled.",
      ],
    },
  ],
};

export default entry;
