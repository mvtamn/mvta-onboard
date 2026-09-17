import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.228",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "A missed-trip review can now record one of four outcomes: confirmed missed trip, timely service, partial-service failure, or indeterminate. Reviews recorded as a false positive now read as timely service.",
        "A trip suspected of not running is not ready to confirm until its scheduled last stop plus 30 minutes has passed, so a trip that ran late can still clear itself first.",
        "Changing a review that was already recorded now needs a reason, and the earlier review stays in the history. Records from the retired detector need a reason to be rereviewed.",
      ],
    },
  ],
};

export default entry;
