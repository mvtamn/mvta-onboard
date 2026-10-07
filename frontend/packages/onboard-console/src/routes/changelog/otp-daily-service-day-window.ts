import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.301",
  date: "2026-10-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Asking the daily OTP data for “the last week” without naming dates now means the last seven service days as MVTA counts them, not as UTC does. Through the whole Central evening the window had already rolled over to tomorrow, so it asked for a day Avail has not published and quietly dropped the oldest day that was wanted.",
      ],
    },
  ],
};

export default entry;
