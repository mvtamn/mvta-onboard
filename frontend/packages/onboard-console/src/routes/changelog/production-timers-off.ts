import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.339",
  date: "2026-10-19",
  sections: [
    {
      heading: "Changed",
      items: [
        "Behind the scenes, production can now be deployed and signed in to before its background jobs start, so it stays quiet until it goes live. Nothing changes on dev.",
      ],
    },
  ],
};

export default entry;
