import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.155",
  date: "2026-09-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Responsible team and Assigned to are chosen from lists rather than typed. Both were free text checked against nothing, which is how the catalog ended up with \\u201cSafety\\u201d, \\u201cSafety / Training\\u201d and \\u201cSafety / Customer Service\\u201d — three teams, or one team spelled three ways, with nothing in the product able to tell.",
        "Both lists are seeded from the teams and owners the catalog already names, so nothing currently recorded is lost and the first edit is a rename rather than a re-entry. They are maintained under Administration \\u203a Performance Assessment \\u203a Lists, alongside units and source systems.",
        "A team or owner the list has not caught up with can still be entered while editing a standard, and is saved on it. Adding it under Lists is what offers it to everyone else.",
      ],
    },
  ],
};

export default entry;
