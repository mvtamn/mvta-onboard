import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.265",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Avail's missed-trip report is now matched to the missed-trip cases OnBoard already holds, instead of sitting in its own table with no connection to them. Each match records how sure it is — exact, probable, or unmatched — and a probable one waits for a reviewer before it affects anything.",
        "Avail never opens a case and never confirms one. It corroborates what detection already found.",
        "Matches survive Avail's nightly rebuild of the feed, an incident it stops reporting is marked rather than quietly dropped, and a match that moves to a different trip loses the confirmation it was given.",
      ],
    },
  ],
};

export default entry;
