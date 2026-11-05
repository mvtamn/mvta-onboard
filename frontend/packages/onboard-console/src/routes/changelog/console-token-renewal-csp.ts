import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.28",
  date: "2026-11-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The console no longer hangs on \"Checking your access…\". Signing in worked, but renewing the sign-in did not: the console renews its access token in a hidden frame, and its own security headers forbade that frame from ever loading. Once the first token aged out the console had no way to get another, so it waited on a renewal that could not finish and showed nothing. Renewal now completes, and a console left open all day keeps working.",
      ],
    },
  ],
};

export default entry;
