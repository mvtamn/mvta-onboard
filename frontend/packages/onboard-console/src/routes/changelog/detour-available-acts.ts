import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.223",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detours & Closures offers only the steps a detour can take right now: Close, Override with reason, Mark review complete, Record human Avail entry and the manual exception each appear when the server would accept them.",
        "When a step is held, the page says why next to it. Confirming an Avail entry names the conflict or the outstanding OCC re-review, and the manual exception stays visible but disabled until the re-review is complete.",
      ],
    },
  ],
};

export default entry;
