import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.158",
  date: "2026-09-08",
  sections: [
    {
      heading: "Added",
      items: [
        "A standard now carries the target the contract states, and it is edited on the page rather than in SQL. It is entered in the same units as the bands — 85, not 0.85 — and shown above the ladder it is not part of. Until now the target lived implicitly in whichever band happened to mean “meets”, and an issued report read “Configured bands” where the figure belonged.",
        "A target can be given the phrase it should read as on a report — “85% or above”, “Under 11 a month” — for the cases a bare number does not say properly. Left empty, the figure itself is shown. The phrase cannot outlive the target it describes: clearing one clears the other, since a phrase with nothing behind it reads as a figure the system knows when nothing knows it.",
        "A counted-events standard can say which number its bands match: the occurrence's own size, or its position in the month. A band bounded 13–16 means an occurrence of that quantity under the first, and the thirteenth through sixteenth occurrence under the second — different rules and different money. The choice is offered only where it is read; a monthly-value standard is scored on one figure, so the setting is cleared rather than left showing something the compute would ignore.",
      ],
    },
  ],
};

export default entry;
