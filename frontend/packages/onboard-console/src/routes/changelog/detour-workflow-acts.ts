import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.221",
  date: "2026-09-16",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Closing a Detour now appears in its workflow history, with who closed it and the reason.",
        "Saving a Detour without changing its closure, dates, riders directed or segments no longer flags it for OCC re-review. Changing any of them still does.",
        "A Detour that is built in Avail now shows \"In Avail\" as its next step instead of \"Needs OCC review\".",
        "Two people acting on the same Detour at the same moment no longer both succeed; the second is told what the first did.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "An Avail entry cannot be confirmed as entered, and a manual fallback cannot be used, while a Detour's OCC re-review is outstanding. Mark review complete first. Recording a failed or deferred Avail attempt, closing, and overriding a conflict are unaffected.",
        "A Detour first seen in the Avail feed is recorded as Avail-backed and fulfilled. It is not treated as a confirmed Avail build.",
      ],
    },
  ],
};

export default entry;
