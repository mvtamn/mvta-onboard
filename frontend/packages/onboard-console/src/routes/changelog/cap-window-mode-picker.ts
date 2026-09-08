import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.156",
  date: "2026-09-08",
  sections: [
    {
      heading: "Added",
      items: [
        "The corrective-action window is now configured in the standards editor rather than in SQL. Pick no window, a rolling number of days, or a calendar quarter; say how many occurrences it takes to trip; and the editor reads the rule back as the sentence it means, including which dates a calendar quarter restarts on. The window the scoring engine reads has existed since migration 107, and the choice between the two ways of counting since 109, but neither had a control — the only way to set one was a hand-written UPDATE.",
        "Each mode keeps only the fields it uses. Choosing a calendar quarter drops the day count, because the quarter's own bounds decide the window and a number nothing reads invites a later reader to believe it means something. Turning the window off clears the threshold with it, because a count with nothing to count it over never trips and would read from the catalog as a rule that is configured.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Three recent changelog entries showed a literal \\u2014 where an em dash belonged.",
      ],
    },
  ],
};

export default entry;
