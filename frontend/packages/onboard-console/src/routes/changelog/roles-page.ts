import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.251",
  date: "2026-09-17",
  sections: [
    {
      heading: "Added",
      items: [
        "Access & Identity has a Roles page. Every role shows its purpose, what it grants in plain words, and how many people hold it. Opening one shows a grid of what each module allows, with a live preview of the description as you tick boxes, so a role can never say one thing and allow another.",
        "Roles now live in OnBoard rather than in Microsoft Entra, so adding one or widening one is a change on this page and takes effect within minutes. Each role keeps a history of who changed it and what they added or removed.",
      ],
    },
  ],
};

export default entry;
