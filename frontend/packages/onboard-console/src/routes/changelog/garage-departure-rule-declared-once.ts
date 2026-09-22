import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.287",
  date: "2026-09-21",
  sections: [
    {
      heading: "Changed",
      items: [
        "The rule that decides whether a garage departure is charged to the contractor is now written down once. It had to exist twice — once for the judgement each row shows on the Garage Departures page, once for the nightly pass that raises it against the assessment — and the two copies were kept in step by hand. The nightly pass now derives its version from the same rule the page reads, so the two cannot say different things about the same departure.",
        "This matters because a raised occurrence is never withdrawn automatically. If the two copies had drifted apart, a run the page showed as fine could still have been charged, and only a person noticing it would have undone that.",
        "Nothing about how a departure is judged has changed: the same runs are flagged, with the same reasons and the same ten-minute allowance. Verified by checking the two forms of the rule agree across every combination of evidence, and by running the nightly pass for real against a database with one departure per possible outcome.",
      ],
    },
  ],
};

export default entry;
