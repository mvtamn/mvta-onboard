import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.71",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Fixed Route Departures now records each run against the agency service day it belongs to. Evening polls previously filed a run under the next calendar day, so the same run could appear twice and be counted twice in the late and expired pullout totals.",
        "Fixed Route Departures no longer shows a zeroed summary under a \"Live data\" badge when its feed is not connected. An unconfigured feed, a missing history table, and an unreachable service now read as three distinct states, and the pullout counts are withheld until the source can actually support them.",
      ],
    },
  ],
};

export default entry;
