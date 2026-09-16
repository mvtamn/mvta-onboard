import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.215",
  date: "2026-09-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand monitoring is switched off, but two paths were still recording MVTA Connect trip data - and trips from other Spare services alongside it. Every path that writes on-demand monitor state now asks the same question first: is monitoring on, and is this trip one of the services being monitored. Nothing else changes on screen; the monitor is still not connected.",
      ],
    },
  ],
};

export default entry;
