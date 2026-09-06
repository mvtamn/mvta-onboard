import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.117",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Decision Matrix: an empty Matrix now says which kind of empty it is - not connected, unavailable, nothing approved yet, or no match for your search - instead of reporting a database that has not been set up as a temporary outage.",
        "Decision Matrix: the severity rail on each Procedure row and card now shows the Procedure's severity - red for Stop service, orange for Restrict service, green for routine - instead of the same neutral colour for every one.",
      ],
    },
  ],
};

export default entry;
