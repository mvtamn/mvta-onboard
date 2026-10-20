import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.322",
  date: "2026-10-15",
  sections: [
    {
      heading: "Changed",
      items: [
        "OTP Review Queue: resetting a month's decisions now confirms in OnBoard's own dialog, naming how many decisions it removes, instead of the browser's pop-up.",
        "Decision Matrix: emergency withdrawal of approved guidance confirms in the same in-app dialog.",
      ],
    },
  ],
};

export default entry;
