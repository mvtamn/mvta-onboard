import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.81",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Detour Reports now lists the legacy spreadsheet rows that have been imported, grouped by source file, and the search box reaches them. The import control appears only for staff who can record detours, instead of failing silently for read-only roles.",
      ],
    },
  ],
};

export default entry;
