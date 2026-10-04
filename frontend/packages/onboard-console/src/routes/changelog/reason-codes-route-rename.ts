import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.304",
  date: "2026-10-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "Reason codes are no longer called OTP reason codes. They have been shared by OTP's stop and weather exclusions and by Missed Trips' investigation outcomes for months; the OTP name made them look like somebody else's setting. Nothing moves on screen and no existing code changes meaning.",
      ],
    },
  ],
};

export default entry;
