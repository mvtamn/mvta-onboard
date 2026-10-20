import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.7",
  date: "2026-10-20",
  sections: [
    {
      heading: "Added",
      items: [
        "“Notify Teams” on a new announcement now posts to Teams. Each selected audience (Operations, Customer Service) gets a card in its own Teams channel with the summary, category, severity, affected routes and expiry. Until now the choice was saved with the announcement and nothing was sent.",
        "An audience with no Teams channel set up yet gets no post, and the announcement still goes out everywhere else. Each post is recorded as sent, failed or skipped.",
      ],
    },
  ],
};

export default entry;
