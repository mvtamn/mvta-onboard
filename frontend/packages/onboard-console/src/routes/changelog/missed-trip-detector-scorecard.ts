import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.8",
  date: "2026-10-20",
  sections: [
    {
      heading: "Added",
      items: [
        "Missed-trip Detectors now answers \"Ready to promote?\" for each detector, above the promotion form. Each detector shows its latest complete service week's precision against the 95% bar, with a sentence saying why a week falls short. A strip of weekly precision runs beside it, coloured by whether each week met the bar.",
        "Select a week in the strip to read its evidence. That covers held cases and indeterminate reviews and why they happened, how often Avail backed or contradicted a case, how often dispatchers' Dispatch Log entries agreed, and how much reviewing it took. For fixed route it also shows the misses nobody flagged: whole trips Avail reported missed, and trips a dispatcher did not see leave, that no case accounts for.",
        "A week that meets the bar has Promote with this week. It puts the week's precision, case count and a reason into the promotion form and takes you to the service date, so the figure recorded on the decision is the one measured.",
      ],
    },
  ],
};

export default entry;
