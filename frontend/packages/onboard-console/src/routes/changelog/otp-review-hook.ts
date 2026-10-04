import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.300",
  date: "2026-10-03",
  sections: [
    {
      heading: "Fixed",
      items: [
        "An error from a failed approve or reject no longer follows you to another service month. It used to stay on screen after switching months, reading as an unexplained problem with a month nobody had touched.",
        "Switching months no longer shows the previous month's decisions against the new one while it loads. A stop reads as undecided until its own month's answer arrives.",
        "A reason typed into a row and left unsaved is forgotten when you switch months, rather than reappearing against a different month's stop.",
      ],
    },
  ],
};

export default entry;
