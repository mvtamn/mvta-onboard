import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.113",
  date: "2026-09-06",
  sections: [
    {
      heading: "Added",
      items: [
        "Garage-departure compliance candidates now cover on-demand duties as well as fixed-route runs. A duty that never departed, or departed later than the variance allowance, on a settled service day becomes a candidate for review, described with which Spare source measured it. Each source is checked against its feed health first.",
      ],
    },
  ],
};

export default entry;
