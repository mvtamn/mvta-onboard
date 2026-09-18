import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.273",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Dashboard's second feed row is now called \"On-demand reconciliation\", not \"MVTA Connect\". It reads one feed - the hourly reconciliation - while MVTA Connect also delivers requests, slots and duties that the row never looked at. Calling it \"MVTA Connect unavailable\" said the vendor was down on a console that was showing Spare deliveries from minutes earlier.",
        "A feed that has never delivered now reads \"Not received\" rather than \"Unavailable\". Never switched on and stopped working are different problems, and the first one is not the vendor's.",
      ],
    },
  ],
};

export default entry;
