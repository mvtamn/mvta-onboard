import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.257",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Administration > Detour contractor notification shows each setting it has, instead of hiding all of them when one is missing. On dev the contractor settings were never seeded, which hid the new default audiences field as well — so the audiences could not be set at all.",
        "Saving writes only the settings that changed, and says which ones it saved.",
      ],
    },
  ],
};

export default entry;
