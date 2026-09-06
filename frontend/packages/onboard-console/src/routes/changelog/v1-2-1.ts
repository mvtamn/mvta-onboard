import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.2.1",
  date: "2026-07-26",
  sections: [
    {
      heading: "Added",
      items: [
        "Persistent OCC alert preparation through the existing Suggested Alerts human-review queue, with source-qualified deduplication.",
        "Direct navigation to and highlighting of the prepared review item.",
        "Non-persistent customer-language previews for local sample scenarios.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Preview banners now explain that mock sign-in cannot access operational data and that preview actions are not saved.",
        "Suggested Alerts can display and focus a previously reviewed item without offering invalid approval actions.",
      ],
    },
  ],
};

export default entry;
