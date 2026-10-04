import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.305",
  date: "2026-10-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Dashboard's triage queue is tighter. Each row is one line of title instead of two, the header is a single line with a count of everything waiting, and five rows now take about two thirds of the height they did. Hover a title for the full text, or open the row.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Detour requests in the triage queue now carry a tinted label like every other kind of row. They had shown as plain grey text since they were added.",
      ],
    },
  ],
};

export default entry;
