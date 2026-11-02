import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.7",
  date: "2026-11-02",
  sections: [
    {
      heading: "Changed",
      items: [
        "Ridership setup: pick each block's garage from a list (Burnsville or Eagan) instead of typing it, so a misspelling can't start a separate print stack.",
        "Ridership setup: select many blocks at once, by checkbox, shift-click or by typing numbers and ranges such as 1-69, 306, 309, and assign them all to a garage in one step.",
        "Ridership setup: the counts by garage at the top filter the list, so you can show just the Unassigned blocks. Save the list now sits above the table rather than after 180 rows.",
      ],
    },
  ],
};

export default entry;
