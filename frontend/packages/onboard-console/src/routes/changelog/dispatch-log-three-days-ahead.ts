import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.43",
  date: "2026-11-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "Count Sheets can be printed up to three days ahead. The Dispatch Log is now built each morning for today and the next three days instead of today and tomorrow, so a garage desk can print Saturday, Sunday and Monday on Friday evening. Each morning's build still refreshes the days ahead, and the print page still marks any sheet whose trips changed since it was printed.",
        "A trip the schedule no longer runs is now removed from a day that has not started yet, so a sheet printed early never lists a trip from an outgoing schedule; the sheet shows as changed and gets reprinted.",
      ],
    },
  ],
};

export default entry;
