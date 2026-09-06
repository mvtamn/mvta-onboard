import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.79",
  date: "2026-09-03",
  sections: [
    {
      heading: "Added",
      items: [
        "Detours & Closures and Detour Reports show each Detour's workflow history - creation, workflow transitions, Avail observations, corrections, and fulfillment confirmation - behind a Show history control.",
        "Administration can now manage Detour reason categories: add a code, relabel or reorder it, and retire it without losing the history that used it.",
      ],
    },
  ],
};

export default entry;
