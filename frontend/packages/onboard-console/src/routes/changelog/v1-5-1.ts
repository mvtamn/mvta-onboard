import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.1",
  date: "2026-08-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Missed Trips: trips scheduled late at night could never be flagged as no-shows once the date rolled over, so late-evening service was effectively invisible to detection. Those trips are now checked correctly.",
        "Missed Trips: the definition of a missed trip now matches ops' own - never ran, or started more than 30 minutes late (it was 15 minutes before).",
        "Missed Trips: a flagged trip that later showed up was being marked resolved no matter how late it was. It now only clears if it actually arrived within the grace window.",
        "Live AVL vehicle positions had been failing on every single poll since launch and showing no vehicles - the request was built in the wrong shape for the feed. Vehicle positions now load.",
        "Route Classification: classifications can now be removed, not just added and changed.",
        "OTP Compliance: the Historical data backfill tool no longer times out when given a wide date range.",
      ],
    },
    {
      heading: "Added",
      items: [
        "Event Monitoring: a real map overlay showing live bus positions for a monitored event, replacing the placeholder.",
        "Route Classification: a way to see which routes still need classifying, instead of having to work it out by hand.",
      ],
    },
  ],
};

export default entry;
