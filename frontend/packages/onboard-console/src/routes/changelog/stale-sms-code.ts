import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.193",
  date: "2026-09-12",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A rider who asks for a new confirmation code and then types the older text is told to use the newer one, instead of being told the code is wrong and losing one of their five tries.",
      ],
    },
  ],
};

export default entry;
