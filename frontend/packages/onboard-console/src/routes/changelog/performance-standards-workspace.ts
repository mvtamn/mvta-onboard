import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.139",
  date: "2026-09-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "Administration \u203a Performance Standards is now a workspace: the catalog on the left, the standard you picked on the right, each scrolling on its own. Selecting a standard used to push its editor below the fold, so every change meant scrolling down to the form and back up to the list.",
        "Each standard has its own submenu \u2014 Details, Penalty bands, Assignment \u2014 instead of one long stacked form. The bands that govern the standard stay visible whichever section is open, since that is usually what the page was opened to check.",
        "The catalog can be searched and filtered: scored on this Agreement, not assigned, measured automatically, or entered by hand.",
        "Agreement assignment moved out of the catalog row into its own section, with the dates it applies over and a note for why. Unassigning is recorded as an end date rather than a deletion, because a month that already scored a standard has to keep resolving what it scored.",
        "The Performance Agreement sits on one line until it is being changed, rather than taking a fifth of the screen above the work.",
      ],
    },
    {
      heading: "Added",
      items: [
        "A standard can be deleted, but only one nothing has ever been assessed against. If it is referenced by a compliance occurrence, a monthly figure or an assessment period, the delete is refused and names what blocked it \u2014 retiring it with an end date is the answer there, and there is now a button for that too.",
      ],
    },
  ],
};

export default entry;
