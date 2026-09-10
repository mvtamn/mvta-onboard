import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.182",
  date: "2026-09-09",
  sections: [
    {
      heading: "Changed",
      items: [
        "Average Miles Between Road Calls is entered as the two figures it is made from - the miles the fleet operated in the month and the chargeable road calls it had - and the console does the division. The owner was typing the finished quotient, which asked them to do the arithmetic at their desk and left the issued report with a figure the contractor could not check. Both figures are kept with the entry, and the saved row shows its working: 412,300 miles ÷ 31 road calls. A month with no road calls records the miles it ran as the figure, which is the floor on the distance between them and well above any target a contract states.",
        "The API refuses a saved figure that is not what its two parts make, to the whole unit, so the working shown on a report always adds up.",
      ],
    },
  ],
};

export default entry;
