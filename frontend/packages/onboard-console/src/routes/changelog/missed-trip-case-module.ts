import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.227",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "An on-demand missed trip that a later Spare evaluation found was not missed stays closed; it no longer reappears in the review queue every 15 minutes.",
        "A cancelled trip that the vehicle data shows ran on time is now closed automatically, the same way a suspected no-show is.",
        "The Dispatch Log marks a trip missed only when it is ready for review or confirmed as missed, not while detection is still waiting on evidence or for records from the retired detector.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Confirming a missed trip no longer adds it to a performance assessment while its detector is still being evaluated (Shadow detection). The review is saved and says so.",
        "An on-demand case the Spare evaluation can no longer decide is held instead of closed.",
      ],
    },
  ],
};

export default entry;
