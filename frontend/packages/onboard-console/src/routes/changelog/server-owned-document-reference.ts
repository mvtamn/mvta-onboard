import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.237",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "When you choose a Procedure's SOP from the approved library, OnBoard reads the document's name, type and link from SharePoint itself when the Draft is saved. If the document changed after you chose it, the save says so and asks you to choose it again, rather than recording a version nobody looked at.",
        "Saving a Draft no longer resets the document checks on documents you kept. Only a newly chosen document needs checking.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Creating a Draft no longer claims the Procedure \"already exists\" when something else went wrong. A value that is too long now names the field, and a Visual rendition that isn't a PNG or JPEG is refused when you choose it instead of failing later when someone opens it.",
      ],
    },
  ],
};

export default entry;
