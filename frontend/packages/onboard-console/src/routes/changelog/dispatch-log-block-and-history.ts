import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.248",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Dispatch Log's Block column shows the block number the workbook uses (001, 024, 501) instead of the transit feed's version-suffixed form (1-v64). The change covers the grid, the watch queue, the trip details, the timeline lanes, search and the CSV export, and applies to days already built.",
      ],
    },
    {
      heading: "Added",
      items: [
        "Initials in the Dispatch Log now show the time they were recorded underneath. The time is when the entry now showing was made, so a correction re-times the cell, and an entry recorded on another day names that day.",
        "Trip details now include History: every change ever made to that trip's Verified cell, newest first, with who made it, what it changed from and to, the note, and the time. Clearing an entry is listed too, so a correction never hides what it replaced. Anyone who can open the Dispatch Log can read it.",
      ],
    },
  ],
};

export default entry;
