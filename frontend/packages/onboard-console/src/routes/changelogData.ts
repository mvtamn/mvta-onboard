// Structured mirror of the repo-root CHANGELOG.md's RELEASED versions only -
// deliberately excludes the [Unreleased] section, which carries internal/
// in-flight notes (some sensitive - e.g. unconfirmed live-environment
// security gaps) not appropriate for a general staff-facing release-notes
// page. Update this by hand alongside CHANGELOG.md when a release is cut -
// same hand-sync convention already used for types mirrored between
// functions-restapi and frontend/shared elsewhere in this repo.
export interface ChangelogSection {
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
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
  },
  {
    version: "1.3.0",
    date: "2026-07-28",
    sections: [
      {
        heading: "Added",
        items: [
          "Missed-trip detection as a compliance investigation tool: explicit GTFS-RT cancellations and schedule-based silent no-shows are flagged into a new Missed Trips module for staff to investigate and validate (confirmed / false positive) - deliberately decoupled from the Suggested Alerts customer-notification queue, since a flagged trip is a compliance record, not an automatic rider alert.",
          "Suggested Alerts now auto-expire to “expired” after 2 hours unreviewed, across every detection source.",
        ],
      },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-07-27",
    sections: [
      {
        heading: "Added",
        items: [
          "Alert via Teams Compose option with separate Operations and Customer Service targets.",
          "Affected-route entry in Compose for internal and customer route-impact messages.",
          "Channel visibility in Active Messages and Audit Log.",
          "Dispatch channel-selection unit tests.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "Subscriber dispatch now honors explicit SMS and email selections, preventing internal or Teams-only messages from being sent to riders.",
          "The rider application now explicitly requests Website messages, preventing internal-only messages from appearing as public service alerts.",
        ],
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-26",
    sections: [
      {
        heading: "Added",
        items: [
          "Persistent OCC alert preparation through the existing Suggested Alerts human-review queue, with source-qualified deduplication.",
          "Direct navigation to and highlighting of the prepared review item.",
          "Non-persistent customer-language previews for local sample scenarios.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Preview banners now explain that mock sign-in cannot access operational data and that preview actions are not saved.",
          "Suggested Alerts can display and focus a previously reviewed item without offering invalid approval actions.",
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-07-26",
    sections: [
      {
        heading: "Added",
        items: [
          "Fixed Route Service Risk OCC workspace with exception-first monitoring, future departure predictions, first threshold-crossing departure, confidence evidence, and a stop-by-stop timeline.",
          "On-Demand Service Quality OCC workspace for the 25-minute wait-time standard, including predicted versus actual wait, assignment context, and confidence evidence.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "GTFS TripUpdate processing now treats departures as MVTA's operational measure, retaining predictions for every usable future stop.",
          "Fixed-route escalation now uses the maximum predicted future departure delay across two consecutive polls instead of only the first stop's current delay.",
        ],
      },
    ],
  },
  {
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
  },
  {
    version: "1.0.0",
    date: "Initial release",
    sections: [
      {
        heading: "",
        items: [
          "React + Vite + TypeScript monorepo replacing the original single-file HTML mockups: rider-app (public Service Alerts + opt-in) and onboard-console (Entra-gated staff dashboard).",
          "Full REST API on Azure Functions (TypeScript): messages CRUD/retract, subscribers, admin config, Suggested Alerts human-review queue.",
          "Role-based access control via Entra ID app roles, enforced both client-side (UI gating) and server-side.",
          "OCC Tools: Event Monitoring, Decision Matrix, and OTP Compliance modules, consolidated into one cohesive design system.",
          "Security hardening: CSP/security headers, Front Door + WAF, managed-identity DB/Storage/Service Bus auth, GitHub Actions CI/CD via OIDC federated identity.",
        ],
      },
    ],
  },
];
