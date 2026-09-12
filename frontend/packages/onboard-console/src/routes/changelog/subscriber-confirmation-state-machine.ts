import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.190",
  date: "2026-09-11",
  sections: [
    {
      heading: "Added",
      items: [
        "The double opt-in state machine: confirming an emailed link or a texted code, capping wrong guesses, and recording an opt-out. No rider-facing path reaches it yet — that is the next change.",
      ],
    },
  ],
};

export default entry;
