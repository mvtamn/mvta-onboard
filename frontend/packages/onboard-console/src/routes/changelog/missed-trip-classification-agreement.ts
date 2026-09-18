import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.266",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "The rule that decides where a missed-trip case stands is checked across every combination of the columns it reads, rather than across whichever cases an earlier test happened to leave behind. Nothing about the rule changes; what changes is how thoroughly the two copies of it are held to each other.",
      ],
    },
  ],
};

export default entry;
