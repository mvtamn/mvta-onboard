import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.246",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Groundwork for managing OnBoard roles inside OnBoard. Roles, what each one lets a person do, and who holds them are now recorded in OnBoard itself, with a plain-English summary written from the access the role actually grants. Nothing has changed about what anyone can do today, and signing in still works exactly as it did.",
      ],
    },
  ],
};

export default entry;
