import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.112",
  date: "2026-09-05",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Decision Matrix admin pages, the expiration-defaults editor, and the audit log's message search now reach the API on Azure. Their endpoints used a route prefix the Functions runtime reserves for itself, so they were never registered and returned 404; they have moved to a new prefix. Who can use them is unchanged.",
      ],
    },
  ],
};

export default entry;
