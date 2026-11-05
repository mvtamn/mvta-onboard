import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.33",
  date: "2026-11-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Integrations & Data Health now reports two more things a database can be missing: the archive that holds OTP figures Avail has stopped sending, and the table behind seeding a Procedure draft from a QRG. Both were missing from an environment for days with nothing on any page saying so, because each feature is built to stay quiet rather than fail loudly.",
      ],
    },
  ],
};

export default entry;
