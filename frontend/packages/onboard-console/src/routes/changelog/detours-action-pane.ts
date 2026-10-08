import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.281",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detours & Closures now reads as a worklist. Each row says what to do next — enter it in Avail, resolve the conflict, close it — who owns it, and anything in the way, instead of keeping that inside the expanded row.",
        "A Managed in column says whether the detour lives in Avail or is operated outside it, which is what decides how it gets carried out.",
        "The communications badge is now the same one the Detour Register shows, so the two pages can't disagree.",
      ],
    },
  ],
};

export default entry;
