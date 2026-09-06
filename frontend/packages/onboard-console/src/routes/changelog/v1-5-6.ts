import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.6",
  date: "2026-08-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event Monitoring: event buses showed as a bare \"Route 1111\" even when the route had been given a name in Route Classification. The map and table now use that name - e.g. \"Route 1111 · Vikings Game Shuttle\" - so you can tell which shuttle is which at a glance.",
      ],
    },
  ],
};

export default entry;
