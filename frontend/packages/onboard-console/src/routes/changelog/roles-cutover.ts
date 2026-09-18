import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.257",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "OnBoard roles are now the only thing that decides what you can do. Your sign-in no longer carries permissions with it, so a role granted or removed in Access & Identity takes effect within about half a minute rather than at your next sign-in.",
        "Signing in is still Microsoft Entra's. If you can sign in but nothing is available, no OnBoard role has been granted to you yet — ask an Access Administrator, who can see you listed as soon as you have signed in once.",
      ],
    },
  ],
};

export default entry;
