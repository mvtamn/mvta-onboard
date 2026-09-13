import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.198",
  date: "2026-09-13",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Service Risk no longer shows the fixed-route feed as failed overnight. When the feed answers on schedule and reports that no trips are running, the banner now reads \"No active trips\" in a quiet tone, and its indicator keeps moving with its countdown and poll history — it had been showing a red failure mark beside a full row of polls that had all arrived. On-Demand Service Quality's \"No active service\" is treated the same way. A feed that is not configured is still shown in red.",
        "The Dispatch Log now shows its live indicator. The banner used to appear only when there was a problem to report, so on a working day the countdown and poll history were never on screen. Today's log now shows them; an earlier day is a settled record and shows no countdown.",
        "The newest poll bar glows only while a feed is live. On a stale or failed banner it now stays flat.",
      ],
    },
  ],
};

export default entry;
