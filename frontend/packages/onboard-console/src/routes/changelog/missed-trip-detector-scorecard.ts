import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.3",
  date: "2026-10-20",
  sections: [
    {
      heading: "Added",
      items: [
        "Missed-trip Detectors has a scorecard beside the promotion form. For each detector, week by week (or day by day), it shows precision from reviewers' outcomes, how many cases were held or ended Indeterminate and why, how often Avail backed or contradicted a case, how often a dispatcher's Dispatch Log entry agreed, and how much reviewing it took. For fixed route it also shows the misses nobody flagged: whole trips Avail reported missed, and trips a dispatcher did not see leave, that no case accounts for.",
        "Each finished week says whether it meets the promotion bar (95% precision with nothing left waiting for review) and, if not, why. A week that meets it has a Use this week button that puts its precision, case count and a reason into the promotion form, so the figure recorded on the decision is the one measured.",
      ],
    },
  ],
};

export default entry;
