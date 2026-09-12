import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.192",
  date: "2026-09-11",
  sections: [
    {
      heading: "Added",
      items: [
        "A rider who clicks the link in their confirmation email now lands on a page that tells them what happened, instead of an empty one. Every outcome has words: confirmed, already used, expired, replaced, or unsubscribed.",
        "An expired or unusable link offers to send a new one, and the opt-in success screen now takes the 6-digit code directly, so a rider can finish in the tab they are already looking at.",
      ],
    },
    {
      heading: "Notes",
      items: [
        "Typing the code into the page is the only way to finish the phone channel until the toll-free number clears carrier verification. Replying to the text needs that number.",
      ],
    },
  ],
};

export default entry;
