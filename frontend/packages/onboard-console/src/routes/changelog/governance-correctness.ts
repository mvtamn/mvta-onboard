import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.166",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The escalation streak counts only months that were actually issued, once each. A month finalized but never issued used to advance it, and a corrected month counted twice — once for the original and once for the correction — so a contractor could reach the +50% escalation on paper without three issued below-standard months. The months the streak was read from are now recorded with each assessment so a dispute can check them.",
        "A shared Validation Draft shows the amounts review recommended, which are the amounts finalization will bind. It used to show the raw proposal, so a charge waived during review still appeared on the contractor's draft at full value and the Final differed without a new validation window. The share is also tied to the exact set of reviewed items; if a review changes afterwards, the month has to be re-shared before it can be finalized.",
        "Adding an exception to a month that has already been shared withdraws the share and reopens the validation window, the same way new evidence does. An exception can no longer be added to an issued month at all — corrections go through a correction period.",
        "Evidence can no longer be altered after it is registered. The file staff upload is verified, copied to a location the upload link cannot reach, and that copy is what the assessment cites; the upload location is cleared.",
        "The report's arithmetic is now true after a waiver. It printed one equation ending in the assessed amount, which a waiver made false; it now prints the computed figure, then the recommendation or binding decision with its reason, then the amount that applies. Excluded inputs are named beside the computed figure rather than subtracted from it.",
      ],
    },
  ],
};

export default entry;
