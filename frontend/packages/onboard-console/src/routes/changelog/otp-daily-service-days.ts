import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.226",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Daily on-time performance data from Avail now loads. The daily import was asking for a service day that had not finished yet, so Avail had nothing to send and no daily OTP data has ever been stored.",
        "Each direction a route serves a stop now keeps its own daily on-time performance figures. Previously one direction would have overwritten the other.",
        "The daily import re-reads the last three days, so a day Avail publishes late is picked up the next morning.",
      ],
    },
  ],
};

export default entry;
