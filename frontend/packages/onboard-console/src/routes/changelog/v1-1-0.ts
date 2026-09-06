import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.1.0",
  date: "2026-07-24",
  sections: [
    {
      heading: "Added",
      items: [
        "GTFS-Realtime Alert feed ingestion: bridges MVTA's dispatcher-entered CAD detour/service-change notices into the Suggested Alerts human-review queue.",
        "GTFS-Realtime TripUpdate delay detection: a 5-minute poll logs every monitored trip's live delay and escalates a sustained delay into a Suggested Alerts candidate. New Live Delays module in OCC Tools.",
        "Redesigned staff console sign-in screen to match MVTA's other internal tools.",
        "This changelog, and a build-time app version badge wired to package.json.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Onboard-console blank page when served through Azure Front Door at /console/*.",
        "Rider-app “Failed to fetch” on Service Alerts, caused by a misconfigured API base URL.",
        "created_by on message creation is now derived from the verified auth principal server-side rather than trusted from the request body.",
      ],
    },
  ],
};

export default entry;
