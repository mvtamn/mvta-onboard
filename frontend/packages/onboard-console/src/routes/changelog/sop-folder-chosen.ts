import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.1",
  date: "2026-11-02",
  sections: [
    {
      heading: "Added",
      items: [
        "The folder OnBoard looks in for SOPs can now be chosen by browsing the approved library, under \"Where new SOPs are looked for\" on the Decision Matrix admin page. Until now it came from an environment setting, so correcting it meant an infrastructure deploy.",
        "The whole library is an explicit choice, for a library whose SOPs aren't in a folder of their own.",
        "The folder is checked against SharePoint before it's saved, so a path that isn't there is refused on the spot with SharePoint's own reason — rather than being accepted and failing quietly at 06:30 the next morning.",
        "The page says whether the folder being watched was chosen here or came from configuration, and how many documents and subfolders are in it.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "A chosen folder outranks the setting permanently. The daily walk used to re-assert the configured folder every morning, which would have silently undone a deliberate choice.",
        "Changing the folder retires the old one rather than deleting it, so what the walk had learned about it — which documents were there, and when each was first seen — is kept. Re-choosing the folder already being watched keeps that history too.",
        "One folder is watched at a time. A document unreferenced in one folder and referenced from another would make \"no Procedure uses this\" a judgement call rather than an answer.",
      ],
    },
    {
      heading: "Note",
      items: [
        "Browsing the library needs the same SharePoint grant the daily walk needs, which hasn't been issued yet. Until it is, the folder picker reports SharePoint's refusal — so this corrects where the walk looks, but doesn't make it able to look.",
      ],
    },
  ],
};

export default entry;
