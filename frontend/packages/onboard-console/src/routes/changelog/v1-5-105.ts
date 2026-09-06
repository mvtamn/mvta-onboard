import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.105",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage-departure review no longer lists five conditions that cannot occur at MVTA. Avail confirmed the underlying data is never collected without an operator scheduling package, so listing them suggested coverage that did not exist. If that changes, the feed will report them rather than passing over them.",
      ],
    },
  ],
};

export default entry;
