import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.280",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detour Reports is now Detour Register. The old name read as something you file rather than something you open, and its description matched the page next to it, so neither said which one to use.",
        "Both detour pages now say what they are for: Detours & Closures is where you work a detour — communications, Avail build, conflicts — and the Register is where the whole set, active and past, can be searched, filtered and exported.",
        "Links and bookmarks to the old address still work.",
      ],
    },
  ],
};

export default entry;
