import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.315",
  date: "2026-10-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Event Plan operating periods are on MVTA's clock, not the browser's. The page said “Times use MVTA-local time” while every conversion used the machine's own timezone — so off a Central machine a planner typed 18:00 meaning six at the garage and stored six wherever they were sitting. Nothing looked wrong, because every later read applied the same wrong offset.",
        "Daylight saving is handled rather than ignored. An overnight period across spring forward is four hours of service though it reads as five on the wall, and across fall back it is six. A wall clock inside the spring-forward gap resolves to the instant the hour reaches; a repeated fall-back wall clock resolves to the first time it happens.",
        "The start-before-end checks go through the agency clock too. Comparing two wall clocks as browser time happens to work on most days, because both carry the same wrong offset — but not across a daylight-saving boundary, where they do not.",
      ],
    },
  ],
};

export default entry;
