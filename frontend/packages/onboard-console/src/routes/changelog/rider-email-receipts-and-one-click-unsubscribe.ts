import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.79",
  date: "2026-11-01",
  sections: [
    {
      heading: "Changed",
      items: [
        "Rider alert emails now carry an Unsubscribe button that Gmail, Yahoo and Outlook show beside the sender. Pressing it stops that rider's emails; any texts they signed up for keep coming.",
        "When an alert email bounces, or the address is on the email service's block list, OnBoard stops emailing that address until the rider confirms it again.",
        "An email or text that was not sent because the sending service is not set up is now recorded as skipped, not failed.",
      ],
    },
  ],
};

export default entry;
