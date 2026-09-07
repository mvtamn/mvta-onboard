import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.132",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "An expired sign-in now says so. When the console could not quietly renew your sign-in, it kept sending requests anyway without it, and every page reported the resulting refusal as though something were broken on the server — Decision Matrix administration blamed the database. The console now tells you your sign-in has expired and sends you back to sign in.",
      ],
    },
  ],
};

export default entry;
