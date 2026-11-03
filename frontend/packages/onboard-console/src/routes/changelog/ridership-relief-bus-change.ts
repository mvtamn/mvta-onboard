import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.16",
  date: "2026-11-02",
  sections: [
    {
      heading: "Added",
      items: [
        "Count Sheets have a \"Relief or bus change\" line under the operator: the relief operator's name, ID and bus, their initials, and the trip # they took over from (the row number in the trip table). Operators are assigned and buses joined on the day, after the sheet prints, so a block that changes hands or buses part way now has somewhere to say so.",
        "Enter sheets has an \"Add relief or bus change\" button for when that line is filled in. It pre-fills from Avail's relief run when Avail has one; OCC picks the trip it starts from, and that trip is marked in the list. A bus swap can leave the operator blank, and a relief on the same bus can leave the bus blank.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Trip rows on the printed sheet are slightly shorter, so a full page of 14 trips still fits with the new line. Sheets already printed stay marked Printed.",
      ],
    },
    {
      heading: "Note",
      items: [
        "Saving a relief or bus change needs migration 162. Until it is applied, a sheet with the change can't be saved (the message says so), and every other sheet saves as before.",
      ],
    },
  ],
};

export default entry;
