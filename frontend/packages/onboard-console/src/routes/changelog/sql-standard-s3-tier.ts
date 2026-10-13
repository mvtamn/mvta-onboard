import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.318",
  date: "2026-10-13",
  sections: [
    {
      heading: "Changed",
      items: [
        "The OnBoard database moved from the serverless tier to a fixed Standard S3 tier, saving roughly $100 a month. Serverless was meant to pause when idle, but the background timers query the database every few minutes, so it never paused and billed about $254 a month in compute. Nothing changes for staff. Last week the database used about 3% of one vCore on average.",
      ],
    },
  ],
};

export default entry;
