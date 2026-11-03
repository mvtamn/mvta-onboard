import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.23",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Open missed-trip cases from earlier days are checked again against when the bus actually left. Before, only today's and yesterday's trips were re-read, so the cases raised before 1.6.22 stayed in the queue even when the bus had left inside the 30 minutes. Those now close as Timely service on their own.",
        "The silent no-shows raised before the September 16 false-positive guards - 1,226 of them from the week of September 7 - are retired once migration 148 is applied. They leave the queue and are kept for audit, the same as the older detector's cases: their outcome is unknown, not false.",
      ],
    },
  ],
};

export default entry;
