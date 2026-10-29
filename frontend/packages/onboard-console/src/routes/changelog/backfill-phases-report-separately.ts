import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.47",
  date: "2026-10-28",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The OTP historical backfill no longer reports a month as failed when it succeeded. The panel ran both feeds in one request — OTP Monthly first, then a Missed Trips reload that could take minutes — so the response carrying the OTP result was not written until the slower half had finished. On 2026-10-28 backfilling 2026-05 and 2026-06 showed \"Request failed (504)\" and \"0 OTP Monthly rows upserted\" for two months whose figures had in fact been written completely. Each feed is now its own request, so a phase that finished is reported as finished whatever becomes of the other, and a failure names the feed that actually failed.",
        "Re-pulling a month from the measurement standard page asks for the OTP figures alone. It used to wait on a Missed Trips reload it never needed, which is what timed it out.",
        "A Missed Trips month reload goes to the database as one bulk load instead of one INSERT per row — the row-at-a-time loop is what made three months take 15+ minutes and is the underlying reason anything timed out. The daily poller takes the same path, so it gets the same speed. The reload is still one transaction: an interrupted run rolls the whole month back rather than leaving it half-loaded.",
      ],
    },
  ],
};

export default entry;
