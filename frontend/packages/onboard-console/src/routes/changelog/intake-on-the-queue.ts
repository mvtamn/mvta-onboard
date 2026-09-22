import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.283",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Detour requests waiting for review now appear on the Dashboard queue, oldest first, and there is a count beside Detour Intake in the menu. Until now nothing told anyone a request had arrived — you had to open the page and look.",
        "A request that was sent back for more information stays off the queue: it is waiting on whoever raised it, not on OCC.",
      ],
    },
  ],
};

export default entry;
