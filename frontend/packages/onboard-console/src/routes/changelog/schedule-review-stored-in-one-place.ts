import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.26",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Schedule Review no longer counts a flag from a check that has since been retired. Before, a route's open page could still count it, and the list of what changed between two reviews could still show it.",
        "The schedule review's history lists each review once. Before, it could show a review that ran unchanged every day as many separate entries.",
      ],
    },
  ],
};

export default entry;
