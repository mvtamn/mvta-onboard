import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.252",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Groundwork for granting OnBoard access inside OnBoard. Access can now be given, removed and approved without changing anything in Microsoft Entra, and signing in once is enough for an Access Administrator to see you and grant you a role.",
        "Granting or removing an access-managing role still needs a second Access Administrator to approve it, within a day, and OnBoard refuses any change that would leave nobody able to manage access. The Access & Identity screens move onto this in the next update.",
      ],
    },
  ],
};

export default entry;
