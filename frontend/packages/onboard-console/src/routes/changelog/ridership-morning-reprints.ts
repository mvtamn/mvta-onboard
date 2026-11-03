import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.6",
  date: "2026-11-02",
  sections: [
    {
      heading: "Added",
      items: [
        "The Print sheets tab on Ridership shows how many of today's Count Sheets need reprinting, such as \"2 to reprint today\", so the morning desk sees it before pull-out without opening the print list.",
        "While Print sheets shows tomorrow, a note at the top names any of today's sheets for the chosen garage that changed after the evening print, with one button to reprint just those for today. It also names a block new since printing, and a printed block that no longer runs today, whose sheet should be taken back.",
      ],
    },
    {
      heading: "Note",
      items: [
        "The Dispatch Log is rebuilt at 3:30 AM each day, and that run can change a block the desk printed the evening before. A garage that hasn't printed today's sheets at all isn't counted: that's a first print, not a reprint.",
      ],
    },
  ],
};

export default entry;
