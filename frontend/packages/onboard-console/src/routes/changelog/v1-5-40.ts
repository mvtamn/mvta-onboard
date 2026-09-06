import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.40",
  date: "2026-08-15",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event crossings and notifications now retain the AVL route ID alongside the bus number.",
        "Administrators can remove geofences by deactivating them from the resource list.",
      ],
    },
  ],
};

export default entry;
