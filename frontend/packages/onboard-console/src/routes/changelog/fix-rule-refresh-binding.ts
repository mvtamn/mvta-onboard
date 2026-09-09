import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.165",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Recomputing a month that had not been finalised failed outright. The rule refresh added in the previous release joins on the Agreement wherever agreement-scoped standards are present, and nothing supplied it — so the statement stopped with “Must declare the scalar variable @agreement” and the recompute rolled back. Caught applying it to dev before anybody met it.",
      ],
    },
  ],
};

export default entry;
