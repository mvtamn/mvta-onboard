import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.302",
  date: "2026-10-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Adding an OTP reason code that already exists now says so, instead of reporting an internal server error. The Detour reason codes already behaved this way; the two pages were running near-identical code that had drifted apart.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "OTP and Detour reason codes are managed by one piece of code rather than two near-copies, so a change to how they work can no longer land on one page and not the other. Nothing about either page changes on screen.",
      ],
    },
  ],
};

export default entry;
