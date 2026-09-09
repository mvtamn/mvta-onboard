import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.162",
  date: "2026-09-09",
  sections: [
    {
      heading: "Changed",
      items: [
        "The What's new panel shows the first five changes of the running release and says how many it left out. It is meant as a glance at the build you are on, and a release carrying a dozen bullets turned it into a page to scroll. The count is shown rather than the list quietly ending, so a truncated panel is never mistaken for the whole release — the full text of every change is on the Changelog page the panel already links to.",
      ],
    },
  ],
};

export default entry;
