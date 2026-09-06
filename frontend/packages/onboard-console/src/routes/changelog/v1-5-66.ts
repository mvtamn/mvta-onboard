import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.66",
  date: "2026-08-27",
  sections: [
    {
      heading: "Changed",
      items: [
        "The top bar no longer shows a single console-wide data status; each workspace states its own health where the data is used.",
        "Fixed-route and Spare missed-trip KPI trust now list Avail Missed Trips as supporting retrospective evidence, visible without gating either stream.",
      ],
    },
  ],
};

export default entry;
