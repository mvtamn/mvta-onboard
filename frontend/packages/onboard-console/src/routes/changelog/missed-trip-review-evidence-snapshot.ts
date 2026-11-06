import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.70",
  date: "2026-11-06",
  sections: [
    {
      heading: "Added",
      items: [
        "Reviewing a fixed-route missed trip now keeps the Start evidence you decided on with the review: the Dispatch Log departure, the bus, the block, the first stop's record and Avail's on-time data. The feeds behind it are pruned, and Avail's on-time data is deleted after 90 days, so a reviewed case would otherwise lose the evidence a contractor may later dispute.",
        "A reviewed case shows that kept copy, with a note saying who reviewed it and when. Changing a review keeps a new copy and leaves the earlier one as it was.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "When the start evidence can't be read, the case now says so in its Start evidence section instead of leaving the section out. If the read failed while a review was being recorded, the review still saves, and the case says no evidence was kept.",
      ],
    },
  ],
};

export default entry;
