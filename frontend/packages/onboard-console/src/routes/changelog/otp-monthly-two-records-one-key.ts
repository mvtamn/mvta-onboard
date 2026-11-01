import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.48",
  date: "2026-10-30",
  sections: [
    {
      heading: "Fixed",
      items: [
        "March 2026's OTP was short by 855 departures. Avail reports a month per route, stop and day of the week, and when a stop is renamed part-way through a month it sends two records for the same route, stop and day — one under each name. Four stops were renamed in March 2026, among them \"Marschall Rd at 4 Av NW corner\", now \"Marschall Rd at 4th Ave NW Corner\". OnBoard stored one row per route, stop and day, so the second record overwrote the first and the figures it carried were gone. March was the only month of 2026 affected: 27 of its 1,081 route/stop/day combinations arrived twice.",
        "Records that share a route, stop and day of the week are now added together, so the month holds every departure Avail published, whatever the stop was called at the time. March's on-time rate was understated as well: the departures that were being dropped were 94% on time, against 90.46% for the month as stored.",
        "March 2026 was re-pulled on 30 October and now reads 67,330 departures, 60,936 on time, 90.50% — up from 66,475 and 90.46%. The 27 corrections are listed as restatements like any other change to a closed month.",
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
