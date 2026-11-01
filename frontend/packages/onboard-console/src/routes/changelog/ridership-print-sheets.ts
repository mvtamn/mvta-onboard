import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.70",
  date: "2026-11-01",
  sections: [
    {
      heading: "Added",
      items: [
        "Ridership › Print sheets: a garage's Count Sheets for a service date as one PDF, ready to print. Tomorrow is chosen to start with; any other date reprints. Pick the garage, and its sheets come off in pull-out order, one block per page.",
        "Each sheet is the agreed paper design: the block and date in large type, a QR code that opens the sheet, boxes for the operator ID, bus and each trip's total, a DNO tick box per trip, three rows for unscheduled trips, and a Reconstructed box.",
        "For printers that default to double-sided, tick Blank back on each page so two blocks never share a piece of paper.",
        "The page says whether the garage has printed yet, and who printed when. If the Dispatch Log changes a block after printing, such as a late tripper, that block is flagged and Reprint just that sheet prints only it.",
        "Scanning a sheet's QR code with a phone, or opening its link, opens that sheet on the Ridership page after sign-in.",
      ],
    },
  ],
};

export default entry;
