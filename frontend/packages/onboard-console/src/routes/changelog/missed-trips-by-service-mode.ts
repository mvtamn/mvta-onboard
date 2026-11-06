import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.69",
  date: "2026-11-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Performance assessment: Missed Trips is now two standards, Missed Trips (Fixed Route) and Missed Trips (Microtransit), as MVTA confirmed on 6 November. A confirmed Spare case counts under microtransit and a confirmed fixed-route case under fixed route. Microtransit's amounts are copied from fixed route for now and are marked as placeholders until MVTA says what a missed microtransit trip is and what it costs.",
        "Performance assessment: a confirmed fixed-route missed trip that was the last trip of its block that day is charged at the last-trip rate ($2,000), not the default rate. Before this, only a missed trip entered by hand could be charged as a last trip.",
      ],
    },
  ],
};

export default entry;
