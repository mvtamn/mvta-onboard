import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.153",
  date: "2026-09-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Performance assessment setup is now four sections under Administration — Contractors, Agreements, Standards and Lists — grouped together but each its own page. They had been stacked inside other screens: contractors behind a toggle in the Performance Assessment module, agreements as a strip above the standards catalog, and the lists behind another toggle beside them.",
        "Contractors are edited on their own. A contractor outlives any one contract term, so its record no longer lives inside the term or the monthly scorecard.",
        "Agreements are edited on their own, and every term a contractor has had is listed rather than only the current one. Each carries its contract number and the name of the standards exhibit it comes from.",
        "The standards catalog now shows which Agreement its assignments are read against, and links to the Agreements section to change it, rather than carrying the editor itself.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Performance Standards appears in Administration's own side navigation. It had been reachable only from the main menu, so anyone who opened Administration and looked down the list could not find it.",
      ],
    },
  ],
};

export default entry;
