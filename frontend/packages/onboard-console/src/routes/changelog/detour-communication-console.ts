import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.250",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Detours page says when a communication cannot go out, and why — a closed Detour, reviewed facts waiting on a re-review, a Detour not in place yet, or an unresolved likely duplicate. Send, Mark published and Draft are disabled with that reason instead of failing at the server after you click.",
      ],
    },
  ],
};

export default entry;
