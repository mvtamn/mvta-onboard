import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.313",
  date: "2026-10-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Approving and activating an Event Plan are now separate permissions from authoring one. Until now a single “Author and activate event plans” permission covered drafting, submitting, approving, activating, suspending, completing, and recording the reasoned override that lets a plan past a route conflict — so the person who wrote a plan could approve it, activate it, and sign off their own override with nobody else involved.",
        "Event Planning says which authority it is waiting on. Where it used to offer a button the API would refuse, a submitted plan now reads “Waiting for a reviewer” and an approved one “Waiting for operations to activate”, and the suspend and complete controls appear only for someone who may use them.",
        "Nobody loses access. Only the System Administrator role could reach Event Planning at all, and it holds every action, so it keeps all three authorities. The new Approve and Activate permissions can be given to other roles in Access & Identity.",
      ],
    },
  ],
};

export default entry;
