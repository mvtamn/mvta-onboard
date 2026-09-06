import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.119",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Audit Log's message search works again. An older message stored its channels in a format the search could not read, and one such row failed the whole search; the same reading is now tolerant everywhere messages are listed, including the rider-facing active alerts.",
      ],
    },
  ],
};

export default entry;
