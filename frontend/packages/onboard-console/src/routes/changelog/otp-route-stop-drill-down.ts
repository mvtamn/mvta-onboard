import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.308",
  date: "2026-10-05",
  sections: [
    {
      heading: "Added",
      items: [
        "OTP Compliance → Route Summary: open any route to see its on-time performance stop by stop. Each stop gets one bar split into on time, early, late and missed, with the month's target marked, and the worst stops come first. Excluded stops are still shown, greyed and labelled with the days that came out, so you can see what moved the route's official figure. Stops with too few departures to judge fairly are listed after the rest.",
      ],
    },
  ],
};

export default entry;
