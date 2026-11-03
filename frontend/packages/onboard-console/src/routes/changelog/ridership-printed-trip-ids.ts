import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.14",
  date: "2026-11-02",
  sections: [
    {
      heading: "Changed",
      items: [
        "Each Count Sheet print now records which trips were printed on it, row by row. Nothing changes on the sheet or on the Print sheets page; this is so scanned sheets can later be matched to the copy that was handed out, even when a block was reprinted after a schedule change.",
      ],
    },
  ],
};

export default entry;
