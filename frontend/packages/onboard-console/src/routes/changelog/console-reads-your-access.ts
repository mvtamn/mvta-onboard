import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.248",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "OnBoard now shows you exactly what your access covers. Pages, links and buttons appear when your role grants them, read from one answer the server gives, so a page can no longer open and then refuse everything on it.",
        "When something is not yours to do, OnBoard says so plainly and names the roles you hold, instead of naming internal role names. If no role has been granted to you yet, you get a short page telling you to ask an Access Administrator.",
      ],
    },
  ],
};

export default entry;
