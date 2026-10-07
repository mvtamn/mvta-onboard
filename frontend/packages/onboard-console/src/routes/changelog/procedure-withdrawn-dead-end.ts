import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.309",
  date: "2026-10-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A bookmarked Procedure that has been withdrawn now says so. The Decision Matrix lists approved revisions only, which is right, but a link saved to a withdrawn Procedure produced no message at all — just a collapsed list of other guidance, which reads as though nothing is wrong. It now states that the guidance must not be used, when it was stopped and why.",
        "A retired Procedure offers its replacement. Ordinary retirement already required an approved replacement; nothing ever showed it to the controller who followed the old link. The replacement is re-checked before it is offered, so a replacement that has since been retired itself is not a second dead end.",
        "A search that hides a Procedure is not reported as a problem. The reader could not previously tell “you filtered it out” from “it was withdrawn”; both looked identical. Only the second warns.",
      ],
    },
  ],
};

export default entry;
