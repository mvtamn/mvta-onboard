import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.53",
  date: "2026-11-05",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Detour Register's CSV export no longer lets text typed into a detour run as a spreadsheet formula. A cell starting with =, +, - or @ is saved with a leading apostrophe, so Excel shows it as typed. The on-screen preview is unchanged.",
      ],
    },
  ],
};

export default entry;
