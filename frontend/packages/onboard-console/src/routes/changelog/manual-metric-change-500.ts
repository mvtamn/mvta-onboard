import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.184",
  date: "2026-09-10",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Changing a hand-entered monthly figure no longer fails. The first figure entered for a month always saved; pressing Change and saving a new one answered \"Internal server error\" every time, because the database allows only one live figure per standard and month and the replacement was being written before the old figure was marked as replaced. The replacement is now written, the old figure pointed at it, and the replacement made live, all in one transaction. Found on dev while re-entering August's road-calls figure as miles and road calls.",
      ],
    },
  ],
};

export default entry;
