import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.331",
  date: "2026-10-16",
  sections: [
    {
      heading: "Changed",
      items: [
        "OTP Review Queue: one card per stop on a route, with every weekday it was flagged on shown as a chip, instead of one row per stop-day. October 2026 had 348 rows for 96 stops, the same stop up to fifteen times, scattered through the list by lean.",
        "“Exclude 5 days” and “Keep 5 days” decide a stop's whole week in one click. Press a day's chip to leave it out, or press a decided day to re-decide it with the rest. One row per stop-day is still written, so the audit trail keeps its shape.",
        "The list scrolls under its toolbar, which reads how many stops are left; the route and status filters show counts; search matches a stop number as well as its name.",
        "After a decision, focus moves to the next stop's primary button, so a reviewer can work down the queue from the keyboard.",
        "Stop names are no longer squeezed into a sliver by the reason dropdown: the card stacks its header, week and actions.",
      ],
    },
  ],
};

export default entry;
