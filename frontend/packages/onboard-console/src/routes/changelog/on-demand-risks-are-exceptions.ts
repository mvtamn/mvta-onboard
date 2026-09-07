import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.138",
  date: "2026-09-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand Service Quality's exception list now holds only the requests that need attention. It was showing every active MVTA Connect request, including ones comfortably inside their service standard, under a heading reading \"Immediate attention\".",
        "The list header says what it was drawn from — \"3 of 41 monitored\" rather than \"3 trips\" — so a quiet service day and a nearly-broken one no longer look alike.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "The summary tile now reads \"Median at-risk wait\", because that is the population it has always measured and now genuinely is.",
      ],
    },
  ],
};

export default entry;
