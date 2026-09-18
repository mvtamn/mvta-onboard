import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.264",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Avail's own missed-trip report now reaches missed-trip cases. Where it names the same run, it is kept with the case as evidence; where it contradicts what the case concluded, the case records an Evidence conflict for a reviewer to settle rather than anything changing on its own.",
        "A trip Avail reports as having run while missing a stop is recorded as a Partial-service failure, not a whole missed trip.",
        "A case with an unresolved Evidence conflict no longer reaches a performance assessment until someone settles it. Its operational outcome is untouched.",
      ],
    },
  ],
};

export default entry;
