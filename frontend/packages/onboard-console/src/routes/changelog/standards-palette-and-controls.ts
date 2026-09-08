import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.144",
  date: "2026-09-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Performance Standards follows the dark theme. The page had been built with its own fixed colours \u2014 a slightly different green, cooler greys \u2014 so its panels stayed white and pale when the rest of the console went dark, and sat a shade off from every neighbouring page in daylight too. It now draws from the console's own palette throughout.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Where a standard's figure comes from is chosen from four cards rather than a dropdown, each showing what that choice means. The choice decides what the standard needs next, so it is no longer hidden behind a closed list. What it measures, and which direction counts as good performance, are now two-way choices shown side by side.",
        "A percentage band's bounds carry a slider beside the number. Percentages run 0\u2013100 on a scale everyone shares and the contract's own thresholds sit on round numbers, so dragging is quicker \u2014 while the number field stays authoritative for a threshold that is not round. Bands measured in miles or occurrences keep the number field alone, where a nought-to-a-hundred track would mean nothing.",
      ],
    },
  ],
};

export default entry;
