import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.51",
  date: "2026-10-31",
  sections: [
    {
      heading: "Added",
      items: [
        "The server side of ridership counting. OnBoard can now list each day's Count Sheets with where each stands (entered, in progress, not entered, late, entered late) and how complete each garage is, and save a sheet with a full record of who changed what. Nothing new is on screen yet; the Ridership page arrives in the next release.",
        "A trip needs a count unless the Dispatch Log calls it missed or canceled, or a reviewer confirmed it missed. Each trip is saved as a number, Not counted or Did not operate, and a trip nobody counted is a gap, never a zero.",
        "A sheet is late if it isn't entered by the end of the day after service, Central time. Correcting a sheet later doesn't change when it was entered.",
        "The operator and bus come from Avail's pull-out for the block's first run. When the paper sheet names someone else, the change is recorded as an override.",
        "Planning's block-to-garage list, dated by service change. A block with no garage shows as Unassigned.",
        "Integrations & Data Health now says when migration 153 hasn't been applied.",
      ],
    },
  ],
};

export default entry;
