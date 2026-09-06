import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.93",
  date: "2026-09-04",
  sections: [
    {
      heading: "Added",
      items: [
        "Emailed Detour communications now show a per-recipient delivery receipt from the mail provider - Delivered, Bounced, Suppressed, Filtered as spam - and a communication reads Delivered only once every recipient is confirmed, with Accepted by provider until then.",
      ],
    },
  ],
};

export default entry;
