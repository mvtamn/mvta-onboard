import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.261",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Import from Entra explains itself. If it finds nothing to import it now says which part came back empty, instead of reporting that Entra has no assignments when it has plenty. A successful import also reports how many assignments it read, beside how many grants it wrote.",
      ],
    },
  ],
};

export default entry;
