import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.147",
  date: "2026-09-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Internal: two database migrations can no longer be given the same number without the build noticing. Migrations are applied in number order by a person reading the folder, so two files claiming one number makes \u201cwhich ran, and in what order\u201d unanswerable \u2014 and it kept happening, because the number is chosen by looking at the folder while another branch is doing exactly the same. Four collided in one week and two more the following day. No console change.",
      ],
    },
  ],
};

export default entry;
