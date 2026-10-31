import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.49",
  date: "2026-10-30",
  sections: [
    {
      heading: "Fixed",
      items: [
        "When Avail stops reporting a route, stop and day of week for a month it still publishes, OnBoard now takes that figure out of the month and keeps a copy in an archive, with the date it was retired and why. Until now it stayed in the month's figure forever, reachable by no poll.",
        "Three months - May, August and September 2026 - were listed as \"measured under a different standard\" by figures that no re-pull could ever update, so the list could not be cleared by using it. Eleven such figures across those months have been archived, and the list empties as intended again.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Re-pulling a month now reports any figures that left it, naming the route, stop and day, and says so on the backfill panel as well as in the logs.",
        "A month is only ever cleaned up by a response that accounted for at least 90% of what OnBoard already holds for it. A shorter response is reported and nothing is removed, because a truncated response and a month that genuinely shrank look the same from the outside - that case is worth a question to Avail rather than a cleanup.",
      ],
    },
  ],
};

export default entry;
