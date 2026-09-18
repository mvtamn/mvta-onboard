import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.272",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Administration → Missed-trip Detectors: see which detectors count toward an assessment and since when, and take one out of Shadow detection — or put it back — from a service date you choose.",
        "A promotion has to show its working. The form asks for the precision measured over a complete service week and how many cases it covers, and will not record a promotion below 95%. The on-demand detector also asks you to confirm its two service weeks, dispatcher agreement and clean feed health. A demotion asks for a date and a reason and nothing else.",
        "Every decision is kept with its evidence, its reason and who made it, so the record answers why a detector started counting.",
      ],
    },
  ],
};

export default entry;
