import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.254",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "A detour communication now goes out on one of five named channels: email, text message and Teams are sent by OnBoard; digital signage and AVL messaging are recorded, because the signs and Avail's messaging are operated elsewhere. Radio is gone — no detour ever used it.",
        "Recording that a message went out is allowed on a closed detour, and carries the date it actually went out rather than the date it was typed. Sending is still refused on a closed detour.",
        "Only email and text messages ask for recipients. A road sign or an Avail message no longer demands an address before it can be recorded.",
      ],
    },
  ],
};

export default entry;
