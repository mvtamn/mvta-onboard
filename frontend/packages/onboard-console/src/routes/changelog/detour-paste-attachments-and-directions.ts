import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.310",
  date: "2026-10-07",
  sections: [
    {
      heading: "Added",
      items: [
        "A new detour can carry attachments from the start. The New Detour form has an Attachments box: drop files on it, pick them with browse, or copy a screenshot or a map out of an email and paste it with Ctrl+V. The files upload when you save. The same box replaces the \"+ Attach files\" button on an existing detour, and Detour Intake's Supporting files box now really takes dropped files.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Turn-by-turn directions get a taller box with one turn per line. Press Enter between turns, and the expanded detour, the Detour Register, and the drafted notice all show them as a list. In the notice, the route sits on its own line above its turns.",
      ],
    },
  ],
};

export default entry;
