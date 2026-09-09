import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.177",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The scorecard reads its figures and targets in words. Compute wrote the raw value and the literal \"Configured bands\", so on-time performance read as 0.8362388553570882 against Configured bands. Compute now writes 83.6% against 85% or above — the contract's own target wording when it has one, the stated value with its direction otherwise, the Meets band's range after that — and an occurrence standard's figure is its count of occurrences. Months computed before this are formatted the same way by the console from the catalog's unit and ladder, so nothing needs recomputing to read properly.",
        "The scorecard's Recommendation column is a pill, in the same colours the standard's detail uses. A month with no Assessment Period no longer counts monthly figures as missing.",
      ],
    },
  ],
};

export default entry;
