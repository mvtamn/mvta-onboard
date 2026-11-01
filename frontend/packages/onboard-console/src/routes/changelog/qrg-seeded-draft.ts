import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.0",
  date: "2026-11-02",
  sections: [
    {
      heading: "Added",
      items: [
        "A Procedure Draft can now be started from a Quick Reference Guide. Pick the QRG in the approved document library and the SOP the Procedure governs, and OnBoard reads the QRG and proposes the criteria and immediate actions it states — instead of retyping a page that already says them.",
        "What comes back is a Draft, and nothing is approved by it. Every field is unreviewed until somebody reviews it, and the Draft reaches Approved through exactly the same review as one typed by hand. A QRG never becomes the source of approved guidance.",
        "The QRG is attached to the Draft as a supporting document, and the SOP you named is the primary one. That is deliberate: a QRG cannot be a Procedure's primary document, so a Draft seeded without an SOP could never have been submitted.",
        "What was proposed is kept, alongside which model proposed it and how much of the QRG was read, so the question \"what did it suggest, and what did we change?\" has an answer later.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "A PDF QRG can now be displayed in the console rather than only linked, so the guide can be read beside the Draft that came from it. What an approved visual rendition may be has not changed — still a PNG or a JPEG.",
        "A QRG revised in SharePoint can seed a fresh Draft; the same unrevised QRG cannot seed a second one. Choosing a QRG that changed after you picked it is refused rather than silently proposing guidance from one version and citing another.",
        "If the guide cannot be read usefully — it is not really a QRG, it is unreadable, or the reading takes too long — you get an empty Draft with the QRG already attached and a line saying why, rather than an error and nothing to work from.",
      ],
    },
    {
      heading: "Note",
      items: [
        "This needs a SharePoint administrator to grant OnBoard read access to the approved document library. Until that grant is made, seeding says so plainly — it is the same grant the daily SOP check has been waiting on.",
      ],
    },
  ],
};

export default entry;
