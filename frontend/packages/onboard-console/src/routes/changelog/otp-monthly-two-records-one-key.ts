import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.48",
  date: "2026-10-30",
  sections: [
    {
      heading: "Fixed",
      items: [
        "March 2026's OTP was short by 855 departures. Avail reports a month per route, stop and day of the week, and when a month holds two schedule patterns it sends two records for the same route, stop and day — one for each pattern. OnBoard stored one row per route, stop and day, so the second record overwrote the first and the figures it carried were gone. March was the only month of 2026 affected: 27 of its 1,081 route/stop/day combinations arrived twice.",
        "Records that share a route, stop and day of the week are now added together, so the month holds every departure Avail published. March's on-time rate was understated as well: the departures that were being dropped were 94% on time, against 90.46% for the month as stored.",
        "March 2026 still holds the short figures until it is re-pulled. Use \"Run backfill\" on the OTP Compliance administration page for 03/2026 — or the \"Re-pull\" button beside it, if the month is listed there.",
      ],
    },
    {
      heading: "Added",
      items: [
        "The backfill panel now says when a month came back with more than one record on a single route, stop and day, how many, and what each record said. A collapse used to be invisible: the poll reported \"1,108 reports seen, 1,108 rows upserted\" for a month that ended up holding 1,081 rows.",
      ],
    },
  ],
};

export default entry;
