import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.181",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A standard's detail page can be opened without a mouse. The scorecard row was a table row with a click handler and nothing else — no button, no role, nothing focusable — so the drill-in existed only for a pointer. A reviewer working by keyboard, or reading with a screen reader, had no way in. The standard's name is now a real button: same look, same row-wide click for the mouse, and a visible focus ring where there was nothing to focus.",
      ],
    },
  ],
};

export default entry;
