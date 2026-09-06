import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.90",
  date: "2026-09-04",
  sections: [
    {
      heading: "Added",
      items: [
        "Detour communications can be sent by email from the server. Send email freezes exactly what goes out, shows Sending, Delivered, or the failing addresses on the communication, and offers Retry send; Open in email and Mark published (sent elsewhere) remain for manual sends.",
      ],
    },
  ],
};

export default entry;
