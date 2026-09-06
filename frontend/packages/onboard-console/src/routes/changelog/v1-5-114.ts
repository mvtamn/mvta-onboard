import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.114",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "OTP Compliance's Administration and Threshold Tuner pages moved out of the Compliance tab and into Administration › OTP Compliance, where only Operations Administrators can reach them. Reason codes, the early/late bias detection threshold and its preview slider, and the historical feed backfill are all on that one page. Reviewers keep every other OTP page unchanged.",
      ],
    },
  ],
};

export default entry;
