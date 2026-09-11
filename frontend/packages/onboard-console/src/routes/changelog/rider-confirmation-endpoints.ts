import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.191",
  date: "2026-09-11",
  sections: [
    {
      heading: "Added",
      items: [
        "A rider can now finish signing up for service alerts. Clicking the link in the confirmation email confirms the email channel; typing the texted code into the page confirms the phone. Until now nothing consumed either, so every rider who subscribed stayed pending and received no alerts at all.",
        "A rider who never got their code, or let it expire, can ask for another one — once every two minutes per channel.",
      ],
    },
    {
      heading: "Notes",
      items: [
        "Texting the code back still does nothing: that needs the toll-free number, which was requested on 2026-09-11 and takes five to six weeks of carrier verification. Typing the code into the page works today.",
        "The page a rider lands on after confirming is the next change; the confirmation is recorded before the redirect either way.",
      ],
    },
  ],
};

export default entry;
