import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.163",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Switching months while an action was finishing could leave the previous month's scorecard rows under the new month's heading. The selected month's rows now come from one loader that drops any answer for a month no longer selected, and the KPI selection resets when the month changes.",
        "A ranged penalty — one the contract writes as a range rather than a fixed figure — can now be given its amount from the Occurrence Log. The 'Set amount' control depended on bounds the list never sent, so it never appeared and the month sat waiting for an amount nobody could enter.",
        "Reviewed items no longer read as pending until the month is finalized. The scorecard and review queue show the recommendation while review is under way and the binding decision once the month is finalized, and say which one they are showing.",
        "The Report page can open what it manages. Each artifact has Preview — the archived bytes, hash-verified, in a sandboxed frame — and Download official HTML, so a reviewer can read the exact draft before attesting to sharing and an Issuing Authority the exact Issuance Proof before issuing.",
      ],
    },
  ],
};

export default entry;
