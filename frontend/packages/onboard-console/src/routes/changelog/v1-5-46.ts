import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.46",
  date: "2026-08-16",
  sections: [
    {
      heading: "Improved",
      items: [
        "Administration is now a management workspace with its own navigation for access, Event resources, service configuration, integrations, governance, and subscribers. Event Planning and Event AVL are grouped under a dedicated Events workspace; existing links still work.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Administration no longer opens a landing page that just repeated its own menu - it goes straight to Service Configuration.",
        "The Administration heading no longer appears twice in the sidebar.",
      ],
    },
  ],
};

export default entry;
