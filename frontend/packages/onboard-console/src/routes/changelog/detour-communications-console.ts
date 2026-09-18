import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.256",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "The detour communications composer offers the five real channels instead of free text: Email, Text message and Teams, which OnBoard sends, and Digital signage and AVL messaging, which it records.",
        "A recorded channel asks no recipients and offers no Send. Instead it asks when the message went out, so an AVL message sent on Monday can be written down on Tuesday with Monday's date — and the row shows that date when it differs from when it was recorded.",
        "Recording is offered even on a closed detour, where sending is still refused.",
      ],
    },
  ],
};

export default entry;
