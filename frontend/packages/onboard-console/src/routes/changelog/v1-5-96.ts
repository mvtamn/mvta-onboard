import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.96",
  date: "2026-09-05",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A garage departure is now only raised for review once its service day has finished. The underlying status moves while a run is still in progress, so a run part-way through its check-in and login sequence could be recorded as a failure and stay in the Occurrence Log even after it departed.",
      ],
    },
  ],
};

export default entry;
