import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.160",
  date: "2026-09-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The daily candidate poll refuses to guess which contractor an observation belongs to. It used to attribute every missed trip and late departure to whichever active contractor had been edited most recently — so saving a contractor record could silently move the next morning's candidates to someone else. An Agreement has exactly one Assessment Contractor, and the poll has no route or division rule to choose by, so it now runs only while exactly one contractor is active and stops with a named error otherwise, the same way it already stopped with none.",
      ],
    },
  ],
};

export default entry;
