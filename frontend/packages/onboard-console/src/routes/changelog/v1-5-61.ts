import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.61",
  date: "2026-08-24",
  sections: [
    {
      heading: "Improved",
      items: [
        "Route Classification now provides a color picker for each route, and Event AVL uses that color for every live bus marker assigned to the route.",
        "Configured route display labels appear throughout Event AVL, including vehicle views, map popups and accessibility labels, search, and newly created status-queue messages.",
        "The critical in-app queue is now explicitly labeled Status queue and remains available when automatic Teams delivery is off; the Teams setting controls external delivery only.",
      ],
    },
  ],
};

export default entry;
