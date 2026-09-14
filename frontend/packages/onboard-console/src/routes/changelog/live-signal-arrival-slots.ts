import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.208",
  date: "2026-09-14",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Opening Service Risk or the Dispatch Log no longer flashes the live indicator as if data had just arrived. The flash now happens only when a new delivery lands while the page is open.",
        "The live indicator no longer flashes twice, or adds an extra poll bar, when the fixed-route feed is read by more than one background job in the same five minutes. Each five-minute poll counts once.",
        "The countdown ring now always points at the next scheduled five-minute poll, including after a late catch-up run.",
      ],
    },
  ],
};

export default entry;
