import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.212",
  date: "2026-09-14",
  sections: [
    {
      heading: "Fixed",
      items: [
        "When OnBoard cannot read the SOP library, the message now names the right fix. It used to send people to Entra, where nothing was missing. If SharePoint refuses the read, a SharePoint administrator has to grant the OnBoard application read access on that site. If SharePoint does not accept OnBoard's sign-in at all, the message now says that instead.",
      ],
    },
  ],
};

export default entry;
