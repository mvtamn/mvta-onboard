import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.273",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Detours & Closures and Detour Reports were both failing to load. A migration from much earlier had never been able to apply — it added a column and, in the same breath, a rule about that column, which SQL Server rejects before running any of it — so three columns the detour list reads were simply missing. Fixed and applied.",
        "A second migration had the same flaw waiting to bite on a fresh database, and the check that was meant to catch this shape only ever looked at one file. It now reads every migration.",
      ],
    },
  ],
};

export default entry;
