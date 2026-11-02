import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.10",
  date: "2026-11-02",
  sections: [
    {
      heading: "Changed",
      items: [
        "Count Sheets name each trip as Avail and dispatch do: 320-E instead of t140-b1F5-sl1B-v64. The printed sheet's Trip column shows it in bold, and Enter sheets shows \"Trip 320-E\" under the times. Point at it to see the GTFS trip ID.",
      ],
    },
  ],
};

export default entry;
