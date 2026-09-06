import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.82",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The legacy spreadsheet import on Detour Reports now reads real Excel CSVs: quoted commas, embedded quotes and line breaks, a BOM, and columns in any order matched by header name. It reports rows skipped for missing closure text and columns it kept but did not recognise, and a Detour Reports export can be re-imported intact.",
      ],
    },
  ],
};

export default entry;
