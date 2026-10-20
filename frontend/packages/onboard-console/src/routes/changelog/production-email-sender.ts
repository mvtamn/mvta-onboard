import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.1",
  date: "2026-10-20",
  sections: [
    {
      heading: "Changed",
      items: [
        "Behind the scenes, production is set up to send rider alert emails from alerts@mvta.com, on MVTA's own domain. Nothing changes on dev, and no email is sent from production until it goes live.",
      ],
    },
  ],
};

export default entry;
