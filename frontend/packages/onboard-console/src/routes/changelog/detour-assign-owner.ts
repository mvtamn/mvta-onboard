import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.282",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Detours can be assigned. Take one with 'Assign to me', hand it on with 'Reassign', or put it back to nobody. Until now an owner could only ever be set when an intake was promoted, so every detour that came from the Avail feed stayed Unassigned with no way to change it.",
        "Assigning doesn't move the detour through its workflow — it only says who acts next — and it's recorded in the detour's history like any other change.",
      ],
    },
  ],
};

export default entry;
