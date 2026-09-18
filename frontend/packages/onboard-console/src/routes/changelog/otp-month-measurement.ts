import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.242",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "\"Routes below target\" on the OTP Dashboard now counts routes on the official figure — fixed-route service only, with approved stop exclusions removed — which is what the card has always said it showed. It used to count the raw figure.",
        "The OTP trend on the Dashboard now plots the same official figure the contractor's assessment scores, so the chart and the scorecard agree.",
        "A month that has already been assessed is compared against the target that assessment used, not against whatever the target says today.",
      ],
    },
  ],
};

export default entry;
