import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.229",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "MVTA Connect garage departures are no longer measured from an incomplete list of a duty's start locations. A duty with more start locations than expected is now reported as unreadable instead.",
      ],
    },
  ],
};

export default entry;
