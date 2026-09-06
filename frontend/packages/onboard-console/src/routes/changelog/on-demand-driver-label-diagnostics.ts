import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.130",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage Departures, On-Demand: the departures poll now reports how many recent duties carry a driver name, a driver identifier and a fleet number, and describes the shape of any Spare driver record that came back without a name, so missing names can be traced.",
      ],
    },
  ],
};

export default entry;
