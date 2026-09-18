import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.278",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "A detour's communications are now one per audience and channel, so the text message and the email can say the same thing at different lengths. Each channel shows its own progress, and an audience counts as told only once every channel it needs has gone out.",
        "Drafting a second channel starts from what you already wrote for that audience, and says where it came from so you edit it rather than send it twice.",
        "You can add an audience the record does not name. It joins the detour's required list like any other.",
      ],
    },
  ],
};

export default entry;
