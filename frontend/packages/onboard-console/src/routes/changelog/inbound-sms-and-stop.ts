import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.195",
  date: "2026-09-12",
  sections: [
    {
      heading: "Added",
      items: [
        "Riders can now reply to the confirmation text with their code, and text STOP to stop alerts. Both are recorded against the number that sent them.",
        "STOP stops texts only. A rider who also gets emails keeps getting them, because stopping texts is not what they asked about.",
      ],
    },
    {
      heading: "Notes",
      items: [
        "This is the last piece of the rider opt-in loop to be built. Nothing of it works until the toll-free number clears carrier verification and the inbound subscription is created — the steps are in HANDOFF.md.",
        "OnBoard never auto-replies to an inbound text. STOP and HELP are answered by the carrier, from the wording registered in the toll-free campaign brief.",
      ],
    },
  ],
};

export default entry;
