import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.247",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Permission messages now say what is missing. If something is not available to you, OnBoard names the access it needs and the roles you hold, instead of listing internal role names.",
        "Behind the scenes, every page's data now checks the access your role grants rather than a separate list kept in the code. Two small corrections come with it: validating missed trips, OTP exclusions and route classification need compliance or configuration access, and Event AVL data needs Event AVL access. Neither was reachable from the pages those people can open.",
      ],
    },
  ],
};

export default entry;
