import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.83",
  date: "2026-09-04",
  sections: [
    {
      heading: "Added",
      items: [
        "Detour Intake warns OCC about likely duplicates: open Detours and other open intake reports that share a route number or a street/landmark name inside an overlapping operating window. The review dialog lists them with what they share, and Mark duplicate of this fills the target in one click. Nothing is merged or rejected automatically.",
      ],
    },
  ],
};

export default entry;
