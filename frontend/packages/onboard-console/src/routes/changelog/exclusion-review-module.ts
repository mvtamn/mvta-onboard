import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.298",
  date: "2026-09-23",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Audit Stream shows a reason's name where it used to show its code — “Recovery point” rather than SCHED_RECOVERY. The Review Queue already showed the name, so the same decision read two different ways depending on which page you opened.",
        "A weather day in the Audit Stream reads as a date a person would say — “8 Sep 2026” instead of 20260908 — and says whether it covered all routes or one.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "An entry in the Audit Stream now says “Stop excluded” or “Stop kept in the figure”, which is what the decision does, rather than “Exclusion approved” or “Candidate rejected”.",
      ],
    },
  ],
};

export default entry;
