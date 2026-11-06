import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.61",
  date: "2026-11-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Integrations & Data Health: a database migration that is applied now reads Passed. It used to read Empty, which put an amber row on the page for every migration that was in fact in place.",
        "Integrations & Data Health: the Avail OTP Daily check now asks for the last completed service days, as the daily import does. It used to ask for a day still in service, which Avail had not published, so it read Empty while the import was working.",
      ],
    },
  ],
};

export default entry;
