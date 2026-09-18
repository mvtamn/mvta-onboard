import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.253",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Access & Identity now grants OnBoard roles directly. People & guests shows everyone OnBoard has seen, the roles they hold and what those roles allow in plain words; granting and removing happen here rather than in Microsoft Entra, and take effect within minutes.",
        "Giving or removing a role that can manage access still needs a second Access Administrator, and now says so clearly instead of failing. The Overview has a one-time Import from Entra for today's assignments, safe to press twice.",
        "Access health reports what matters now: people who can sign in but hold no role, access about to end, whether a privileged change could be approved today, and roles nobody holds.",
      ],
    },
  ],
};

export default entry;
