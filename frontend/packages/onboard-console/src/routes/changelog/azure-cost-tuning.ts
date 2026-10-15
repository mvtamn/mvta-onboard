import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.318",
  date: "2026-10-13",
  sections: [
    {
      heading: "Changed",
      items: [
        "The OnBoard database moved from the serverless tier to a fixed Standard S3 tier, saving roughly $100 a month. Serverless was meant to pause when idle, but the background timers query the database every few minutes, so it never paused and billed about $254 a month in compute. Nothing changes for staff. Last week the database used about 3% of one vCore on average.",
        "Less logging noise, about $20 a month less. Every Spare webhook delivery wrote two \u201cExecuting / Executed\u201d lines to the logs, which was about 70% of everything logged, although each delivery is already recorded once as a request. Those lines are gone. Warnings and errors from the webhook, and its own messages, are kept.",
        "Logging now has a 2 GB a day ceiling, about three times normal, so a runaway loop cannot run up the bill. Database backups are set to stay in one region, since dev is the only environment.",
      ],
    },
  ],
};

export default entry;
