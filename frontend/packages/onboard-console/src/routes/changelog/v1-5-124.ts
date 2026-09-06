import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.124",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage Departures, On-Demand: the Operator column now shows the driver's name, with Spare's driver identifier beside it and the Spare id on hover, once the poll has looked the driver up. Grouping by operator uses the name.",
        "Garage Departures, On-Demand: the Duty column is hidden when no duty in view has a Spare identifier; each row keeps its Spare duty id on hover.",
      ],
    },
  ],
};

export default entry;
