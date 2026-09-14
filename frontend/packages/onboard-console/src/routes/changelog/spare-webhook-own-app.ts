import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.211",
  date: "2026-09-14",
  sections: [
    {
      heading: "Changed",
      items: [
        "Groundwork for keeping live data current during busy periods: the connection that receives MVTA Connect updates from Spare is being moved onto its own server, so bursts of those updates can no longer slow down the fixed-route and on-demand feeds. Nothing changes in the console yet; the switch-over is a separate step.",
      ],
    },
  ],
};

export default entry;
