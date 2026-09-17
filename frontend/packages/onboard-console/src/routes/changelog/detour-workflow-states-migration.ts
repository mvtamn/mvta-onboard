import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.222",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detours that came from the Avail feed now show Enter in Avail as their fulfillment path, instead of Fixed-route manual.",
        "Any Detour still marked Approved moves to Awaiting fulfillment when it is Avail-backed, or Fulfilled otherwise, and the move is recorded in its workflow history.",
      ],
    },
  ],
};

export default entry;
