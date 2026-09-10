import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.183",
  date: "2026-09-09",
  sections: [
    {
      heading: "Changed",
      items: [
        "The issued report shows the working behind Average Miles Between Road Calls. Under the month's figure, in the results table and again in its computation detail, the report now prints the two quantities it was made from - 412,300 miles ÷ 31 road calls - so the contractor can check the division the month was scored on. The scorecard and the standard's detail page show the same line. The working is captured when the month is computed, beside the figure, so a report re-rendered later says what was true at the time; a figure typed whole prints nothing extra. Needs migration 115.",
      ],
    },
  ],
};

export default entry;
