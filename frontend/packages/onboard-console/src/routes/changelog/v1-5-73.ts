import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.73",
  date: "2026-09-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "A garage departure now becomes a reviewable occurrence only when the bus never left the garage or left more than ten minutes late, rather than whenever Avail marked the pullout window elapsed. Each occurrence says which of the two it was, so the Occurrence Log can be triaged at a glance.",
        "Garage-departure occurrences already raised under the previous rule are cleared from the Occurrence Log where the record shows the bus departed acceptably, each one keeping a note of why it was dismissed. Occurrences somebody has already reviewed are left as they are.",
      ],
    },
  ],
};

export default entry;
