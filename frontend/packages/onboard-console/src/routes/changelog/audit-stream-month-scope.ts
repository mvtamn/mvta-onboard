import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.291",
  date: "2026-09-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The OTP Audit Stream's “Current month only” checkbox now applies to weather exclusions too. It only ever filtered the stop-exclusion entries, so a stream you had scoped to one month still listed every weather and emergency day ever recorded, mixed in among that month's decisions.",
        "The Audit Stream asks the database for the newest entries rather than reading both exclusion tables in full and keeping the first hundred. Nothing on screen changes when the tables are small, but the page no longer gets slower every time a weather day is logged.",
      ],
    },
  ],
};

export default entry;
