import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.133",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A document check that fails because OnBoard cannot reach SharePoint now says so, instead of reporting that the document was unavailable. The three ways a check can fail — OnBoard has not been granted the library, SharePoint refused its credential, or the file genuinely is not where the Procedure records it — now read differently, so a configuration problem no longer sends you looking through SharePoint for a document that is sitting there correctly.",
      ],
    },
  ],
};

export default entry;
