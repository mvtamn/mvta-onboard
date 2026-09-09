import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.173",
  date: "2026-09-09",
  sections: [
    {
      heading: "Added",
      items: [
        "Monthly Metrics tells the signed-in owner which of their hand-entered figures the month is still waiting for, and lists everyone else's open ones with the name they are assigned to. An owner in Administration › Lists can now carry the account that signs in as them; a value with no account is a team, and that is fine.",
        "The Occurrence Log and Monthly Metrics load only the selected month's rows rather than every row the agency has, and the period list is capped; a filter on the request replaces filtering after the fact.",
      ],
    },
  ],
};

export default entry;
