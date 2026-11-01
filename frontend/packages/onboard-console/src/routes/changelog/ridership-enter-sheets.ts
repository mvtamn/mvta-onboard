import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.56",
  date: "2026-11-01",
  sections: [
    {
      heading: "Added",
      items: [
        "A Ridership page under Specialist Operations for keying Count Sheets. It opens on a worklist of sheets still to enter, late ones first, with how complete each garage is. Choosing a garage shows only its sheets.",
        "A sheet opens laid out like the paper: the operator and bus from Avail's pull-out, the block's trips in order with their Dispatch Log status, and one box per trip. Type a number, N for Not counted or D for Did not operate. Enter moves down the trips and onto Save, Save goes straight to the next sheet, and Esc goes back to the worklist.",
        "When the paper names a relief operator or another bus, type it over Avail's, or pick one of the block's other runs. The sheet says it differs from Avail.",
        "Add an unscheduled trip from the sheet (route, direction, start, reason and its count), and mark a sheet Reconstructed.",
        "If someone else saved the same sheet while you had it open, OnBoard says so and offers to reload it rather than overwriting their work.",
        "Administration › Ridership setup, for Planning: which garage runs each block, from the first day of each service change. A block with no garage shows as Unassigned.",
      ],
    },
  ],
};

export default entry;
