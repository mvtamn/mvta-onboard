import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.171",
  date: "2026-09-09",
  sections: [
    {
      heading: "Added",
      items: [
        "Excusable-delay claims can be filed and decided in OnBoard. A claim records the event and when written notice arrived; notice more than 24 hours after the event is flagged so the Issuing Authority sees it before approving or denying with a note. An approved claim can be linked to a confirmed occurrence from the Occurrence Log, which removes that occurrence from the month's assessable inputs — the scoring already honored this; now something creates it. Deciding a claim on a month already shared with the contractor reopens its validation.",
        "System outage windows can be logged and ended. An occurrence observed by a system while it was down — Avail for fixed-route trips and pullouts, Spare for on-demand — is excluded from scoring, with the excluded count kept beside the raw one. Which system a given occurrence came from follows its source reference; a hand-entered occurrence has none and no outage excuses it.",
      ],
    },
  ],
};

export default entry;
