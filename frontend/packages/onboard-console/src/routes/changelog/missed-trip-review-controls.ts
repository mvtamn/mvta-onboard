import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.229",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips reviews offer four outcomes: Confirmed missed trip, Timely service, Partial-service failure and Indeterminate.",
        "Changing a review that is already recorded asks why, and the earlier review stays in the history. A record from the retired detector asks why it is being rereviewed.",
        "A trip that is still awaiting evidence cannot be confirmed yet; the panel says what it is waiting for. Each trip also shows where it stands and what the evidence found.",
      ],
    },
  ],
};

export default entry;
