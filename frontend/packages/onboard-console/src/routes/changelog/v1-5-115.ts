import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.115",
  date: "2026-09-06",
  sections: [
    {
      heading: "Added",
      items: [
        "On-demand wait monitoring can now tell which service area a request came from. The MVTA Connect zone boundaries are imported from the published service-area file and put into force deliberately, so a change to the boundaries is a reviewed step rather than something that happens overnight. Until now no boundaries were loaded at all, and every on-demand request was recorded without a zone.",
        "Administrators can review imported zone boundary versions and see which one is in force, when it was put into force, and by whom.",
      ],
    },
  ],
};

export default entry;
