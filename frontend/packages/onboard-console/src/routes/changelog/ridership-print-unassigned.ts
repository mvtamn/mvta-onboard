import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.8",
  date: "2026-11-02",
  sections: [
    {
      heading: "Changed",
      items: [
        "Print sheets: a garage's view now says how many blocks have no garage on that date and which ones, because they are in no garage's stack. One click opens them under Unassigned, where they print like any other stack.",
        "Print sheets: the note for a date with no trips yet gives the right time. Each date's trips arrive at 3:30 AM the day before (4:30 AM during daylight saving time).",
      ],
    },
  ],
};

export default entry;
