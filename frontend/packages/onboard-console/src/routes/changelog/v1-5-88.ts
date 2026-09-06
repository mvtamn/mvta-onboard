import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.88",
  date: "2026-09-04",
  sections: [
    {
      heading: "Added",
      items: [
        "Detours & Closures warns when a Detour overlaps another open Detour on the same route or place in the same window, and requires a recorded reason to proceed before the Avail entry can be confirmed. The reason and the conflicting Detours stay in the workflow history; Detour Reports shows and exports the conflict state.",
      ],
    },
  ],
};

export default entry;
