import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.80",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Accepting a Detour Intake no longer files the closure location as Riders directed. The Detour now carries its own Location, shown in the operational record and exported in the Reports CSV; existing promoted Detours are corrected by migration 088.",
      ],
    },
  ],
};

export default entry;
