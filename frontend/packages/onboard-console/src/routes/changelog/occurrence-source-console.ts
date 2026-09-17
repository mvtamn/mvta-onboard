import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.240",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Occurrence Log says which module an occurrence came from and what to look for there, using what the server read from the observation. A missed trip from on-demand service now says so.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "The occurrence list said every occurrence was hand-entered or automatic based on the wrong field. Whether an occurrence was entered by hand is reported correctly again.",
      ],
    },
  ],
};

export default entry;
