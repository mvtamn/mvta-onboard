import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.35",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A late-night trip still running after midnight is now recorded on the day it started. Route 495's 23:02 trip used to have its after-midnight bus reports filed under the next day, so the Dispatch Log showed the next night's trip as starting about 23 hours early, and a missed late-night trip could have looked as if it ran.",
        "The Dispatch Log no longer takes a bus report from hours before a trip's scheduled start as that trip's start.",
        "Once migration 150 is applied, the 28 Dispatch Log starts from September 6 to October 22 that were the previous night's bus show no actual start, and the bus records behind them are corrected.",
      ],
    },
  ],
};

export default entry;
