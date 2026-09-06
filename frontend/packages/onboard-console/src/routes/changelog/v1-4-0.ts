import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.4.0",
  date: "2026-08-05",
  sections: [
    {
      heading: "Added",
      items: [
        "Detour & Closure module: one place for every detour/closure (replacing the hand-tracked mix of Avail, staff email, and an Excel tracker), with computed Active/Upcoming/Monitor/Recently finished/Expired status, manual entry, and photo attachments.",
        "Detour & Closure records now sync automatically with Avail for any detour actually built there, alongside manual entries for everything Avail can't handle.",
        "Route Classification (Admin) and a live special-event vehicle positions panel in Event Monitoring.",
        "Live AVL vehicle positions panel in Event Monitoring, using Avail's own vehicle-tracking feed.",
        "Fixed Route Departures, a new Compliance module tracking on-time garage pullout.",
        "OTP Compliance now shows real OTP % and missed-trip data instead of mock data, including real Monthly Assessments.",
        "OTP Compliance's Audit Stream, Administration, and Threshold Tuner pages are now real, with persisted exclusion decisions, admin-editable reason codes, and a new OTP % trend chart on the Dashboard.",
        "A dedicated Compliance tab for OTP Compliance and Missed Trips.",
        "Decision Matrix QRG grid view, matching the printed Quick Reference Guide's layout.",
        "This in-app Changelog page.",
        "Compose's affected-routes field now pulls from the live route registry (including MVTA Connect) instead of free-typed text.",
        "AI-drafted rider-friendly summaries in Compose, including auto-draft while typing.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "An approved OTP exclusion now correctly updates a route's Official OTP % once that route has a route label.",
      ],
    },
  ],
};

export default entry;
