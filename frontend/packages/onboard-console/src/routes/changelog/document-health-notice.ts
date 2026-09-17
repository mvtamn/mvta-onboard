import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.235",
  date: "2026-09-17",
  sections: [
    {
      heading: "Added",
      items: [
        "Decision Matrix administration now tells you when document checks aren't working: when they haven't been set up, when SharePoint has refused them, or when documents haven't been checked recently. Before, the overnight check could stop running for days with nothing on screen to show it.",
      ],
    },
  ],
};

export default entry;
