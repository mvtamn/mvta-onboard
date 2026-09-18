import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.268",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Taking a missed-trip detector out of Shadow detection is now a dated decision rather than a deployment setting. It records the service date it applies from, the precision and sample size it was measured on, why, and who decided — and it only counts cases from that service date onward, so promoting a detector no longer adds missed trips to months that were already measured.",
        "A detector can be demoted the same way. The service dates it was trusted for keep counting exactly as they did.",
        "The reporting view reads the same history, so Power BI and the console can no longer disagree about which detections count toward an assessment.",
      ],
    },
  ],
};

export default entry;
