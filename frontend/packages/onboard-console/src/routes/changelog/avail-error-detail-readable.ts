import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.33",
  date: "2026-11-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "When Avail refuses a request, Integrations & Data Health now shows Avail's own reason. A failing Avail feed previously read only \"success=false: [object Object]\", which hid why Avail said no.",
      ],
    },
  ],
};

export default entry;
