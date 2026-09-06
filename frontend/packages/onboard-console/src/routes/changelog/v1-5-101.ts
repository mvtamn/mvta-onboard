import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.101",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "The garage-departure feed now reports any pullout status it does not recognise. Compliance review only covers the conditions it has been told about, and an unrecognised one was previously ignored without any sign, so a new or differently-spelled status could go unnoticed for a whole reporting period.",
      ],
    },
  ],
};

export default entry;
