import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.154",
  date: "2026-09-08",
  sections: [
    {
      heading: "Added",
      items: [
        "A corrective-action rule can now count either way a contract writes one: over a rolling number of days, or within a calendar quarter. They are not versions of the same thing — three cases in December and three in January breach a quarterly rule never and a rolling ninety-day rule almost certainly — so which one a standard means is recorded rather than assumed, and rules written before this keep counting in rolling days exactly as they did.",
        "Operator Staffing & Qualifications is now the four standards it actually contains: staffing level below the requirement, Pivot Operator coverage, Pivot Operator misuse, and unqualified operators deployed. They share a contract clause and nothing else — four different units, four kinds of evidence, four penalties — and one standard can only carry one unit, so as a single entry three of the four penalties had nowhere to live. Each is added dormant, so holding a contractor to one is a deliberate choice on their Agreement. The combined entry is retired rather than deleted, and says what replaced it.",
      ],
    },
  ],
};

export default entry;
