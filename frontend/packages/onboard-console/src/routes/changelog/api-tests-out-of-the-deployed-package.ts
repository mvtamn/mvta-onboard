import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.136",
  date: "2026-09-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Nothing changes on screen: the API no longer runs its own unit tests each time it starts, which was adding their output to the service logs and slowing every restart.",
      ],
    },
  ],
};

export default entry;
