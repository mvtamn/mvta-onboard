import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.39",
  date: "2026-08-15",
  sections: [
    {
      heading: "Improved",
      items: [
        "Operating periods now use separate local date/time fields and resource selection uses searchable checkboxes.",
        "Direction rules are organized into matching, movement, and message steps with compass presets, clearer delivery labels, and an Event AVL message preview.",
      ],
    },
  ],
};

export default entry;
