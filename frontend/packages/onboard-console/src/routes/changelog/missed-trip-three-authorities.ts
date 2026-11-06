import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.71",
  date: "2026-11-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Reviewing a missed trip now records only what happened. The review no longer asks whose error it was. A confirmed missed trip goes into the month's performance assessment as awaiting attribution, and it is not charged until a manager records whose error it was.",
        "Managers record attribution (contractor error or MVTA-directed) on the missed trip itself, on a garage departure, or in the Performance Assessment occurrence log. Only the COO can decide that an occurrence was excusable, or change one that was.",
        "Each missed trip and each occurrence now shows who recorded the outcome and who decided its attribution.",
        "Entering an occurrence by hand charges it only if the person entering it can attribute. Otherwise it waits for a manager.",
      ],
    },
  ],
};

export default entry;
