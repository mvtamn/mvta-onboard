import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.123",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Administration › Decision Matrix now says which database migration each part of the page is waiting on, instead of one message that blanked the whole workspace. It tells apart a database that has not been set up from a genuine fault, and a section that fails no longer hides the sections that are working.",
        "The Create Draft and Add rule forms are hidden until the tables they write to exist, rather than accepting entries that could only fail on submit.",
      ],
    },
  ],
};

export default entry;
