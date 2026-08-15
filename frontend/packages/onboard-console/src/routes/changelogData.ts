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
    version: "1.5.35",
    date: "2026-08-15",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event AVL now loads the shared active-vehicle feed before an Event is selected; selecting an Event still adds plan membership and geofence scope.",
        ],
      },
    ],
  },
  {
    version: "1.5.34",
    date: "2026-08-15",
    sections: [
      {
        heading: "Changed",
        items: [
          "Route Classification now uses operator-friendly route names, service-type explanations, explicit label guidance, readable update details, route counts, and descriptive actions.",
        ],
      },
    ],
  },
  {
    version: "1.5.33",
    date: "2026-08-14",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event geofence notifications now include the bus number explicitly.",
          "Event Planning now distinguishes operational-only geofences from messaging-enabled geofences while activating them in one operating period.",
        ],
      },
    ],
  },
  {
    version: "1.5.32",
    date: "2026-08-13",
    sections: [
      {
        heading: "Changed",
        items: [
          "The sidebar now presents the running version as a distinct badge with a clearer What’s new action.",
          "Release notes now open the exact running build, restore missing releases 1.5.8 through 1.5.31, and make the full history easier to scan with expandable releases.",
        ],
      },
    ],
  },
  {
    version: "1.5.31",
    date: "2026-08-13",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event Planning now uses a guided scope canvas for choosing and editing Routes, Geofences, or Transit locations before activation.",
        ],
      },
    ],
  },
  {
    version: "1.5.30",
    date: "2026-08-13",
    sections: [
      {
        heading: "Changed",
        items: [
          "Plan details and resources now share one workspace with resource cards, readiness counts, and a visible activation gate.",
        ],
      },
    ],
  },
  {
    version: "1.5.29",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event Planning now presents one continuous Plan, Configure, Activate, and Monitor workflow for the selected operating period.",
        ],
      },
    ],
  },
  {
    version: "1.5.28",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "A prominent next-action panel now guides Event Planning operators to the exact step required next.",
        ],
      },
    ],
  },
  {
    version: "1.5.27",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event AVL now keeps an operating brief beside the live map with vehicle, plan membership, assignment, and alert-readiness totals.",
        ],
      },
    ],
  },
  {
    version: "1.5.26",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event AVL now shows active SpecialEvent vehicles before plan assignment while keeping managed classification and alerts plan-scoped.",
        ],
      },
    ],
  },
  {
    version: "1.5.25",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event Map Authoring now uses prominent labeled location markers and visibility controls that match Event AVL.",
        ],
      },
    ],
  },
  {
    version: "1.5.24",
    date: "2026-08-12",
    sections: [
      {
        heading: "Changed",
        items: [
          "Event AVL now keeps active vehicles visible before plan assignment and separates unassigned vehicles for follow-up.",
        ],
      },
    ],
  },
  {
    version: "1.5.23",
    date: "2026-08-12",
    sections: [{ heading: "Changed", items: ["Event AVL locations now use prominent haloed markers, persistent labels, active/inactive colors, and an on-map legend."] }],
  },
  {
    version: "1.5.22",
    date: "2026-08-12",
    sections: [{ heading: "Changed", items: ["Event AVL can now show the full active and inactive geofence and transit-location catalog without expanding the live operating scope."] }],
  },
  {
    version: "1.5.21",
    date: "2026-08-12",
    sections: [{ heading: "Changed", items: ["Event AVL now defaults to the most relevant Event context and clearly identifies missing or inactive operating scope.", "Event Workspace navigation now links Configure to Event Configuration and states the route-readiness requirement explicitly."] }],
  },
  {
    version: "1.5.20",
    date: "2026-08-12",
    sections: [{ heading: "Changed", items: ["Event Planning now shows planned resources before review and activation controls and explains when validated scope reaches Event AVL.", "Event AVL map cleanup now tolerates already-removed resources so navigation cannot blank the console."] }],
  },
  {
    version: "1.5.19",
    date: "2026-08-11",
    sections: [{ heading: "Changed", items: ["Event switching now protects unsaved edits; Event Planning adds resource removal, bulk linking, Event duplication, search, and clearer accessible readiness states."] }],
  },
  {
    version: "1.5.18",
    date: "2026-08-11",
    sections: [{ heading: "Changed", items: ["The operating-period lifecycle now distinguishes the primary next action, revision work, secondary actions, and the separate suspended state."] }],
  },
  {
    version: "1.5.17",
    date: "2026-08-11",
    sections: [{ heading: "Fixed", items: ["Mobile Event Workspace navigation and Sign Out are usable again; event-period edits are protected and expired sessions offer a real sign-in action."] }],
  },
  {
    version: "1.5.16",
    date: "2026-08-11",
    sections: [{ heading: "Changed", items: ["Event Planning adds confirmation and clearer feedback for lifecycle actions, fixes dark-mode status contrast, and makes the console shell usable on mobile and tablet."] }],
  },
  {
    version: "1.5.15",
    date: "2026-08-10",
    sections: [{ heading: "Added", items: ["Events, Service Plans, operating periods, and reusable map resources now share one validated operating model and active operational scope."] }],
  },
  {
    version: "1.5.14",
    date: "2026-08-10",
    sections: [
      {
        heading: "Added",
        items: [
          "Event Monitoring now records 90-day telemetry diagnostics, component health, and retention-cleanup status for shared AVL ingestion, event projection, and crossing detection.",
          "Live event vehicles now show their active Service Plan scope, and secondary crossing, notification, and audit feeds retain their last successful data while reporting failures.",
          "Route classifications now validate local effective-date ranges, preserve prior versions, and reject stale edits; geofence updates validate geometry and reject conflicting edits.",
        ],
      },
    ],
  },
  {
    version: "1.5.13",
    date: "2026-08-09",
    sections: [
      {
        heading: "Added",
        items: [
          "Event Monitoring now includes admin-managed locations, geofences, direction-aware crossings, notification review, audit history, and active Service Plans.",
          "Normal infrastructure redeployments no longer rewrite the Key Vault SQL connection secret; intentional credential rotation is coordinated and restarts the Function Apps.",
        ],
      },
    ],
  },
  {
    version: "1.5.12",
    date: "2026-08-08",
    sections: [
      {
        heading: "Added",
        items: [
          "Performance Assessment is now a top-level main-menu workspace for contractor-month scorecards, KPI details, occurrence review, manual metrics, manager review, and Attachment G standards.",
          "Confirmed GTFS and Spare missed trips flow into the assessment occurrence log exactly once and require explicit contractor attribution before they affect a monthly assessment.",
          "Assessment calculations are revisioned and hash-audited; finalized report artifacts are stored as verified HTML with governed issuance metadata.",
        ],
      },
    ],
  },
  {
    version: "1.5.11",
    date: "2026-08-08",
    sections: [
      {
        heading: "Changed",
        items: [
          "Missed Trips now shows 10 candidates by default, with 10, 25, 50, or 100 trips per page and Previous/Next navigation in both List and Table layouts.",
          "The selected-trip investigation panel stays within the viewport and resets to the top when another trip is selected, so reviewers do not need to scroll back up the full queue.",
          "Unreviewed candidates remain human-review items: Aging and Overdue labels communicate urgency without automatically confirming or dismissing a trip.",
        ],
      },
    ],
  },
  {
    version: "1.5.10",
    date: "2026-08-08",
    sections: [
      {
        heading: "Changed",
        items: [
          "Missed Trips now keeps GTFS and Spare evidence distinct in one review queue. Spare candidates show the exact late-start, same-duty supersession, and late-arrival conditions that triggered them.",
          "The Spare pipeline reads only bounded recent Requests and Slots windows, retains no rider contact or location data, and excludes rider/no-fault or unattributed cancellations from automatic contractor findings.",
          "The review queue, history, feed-health warnings, and monthly assessment views now carry source-aware evidence and labels.",
        ],
      },
    ],
  },
  {
    version: "1.5.9",
    date: "2026-08-07",
    sections: [{ heading: "Fixed", items: ["AVL Reports now requests its feed window in agency-local time, allowing Event AVL and Route Classification to receive current vehicles."] }],
  },
  {
    version: "1.5.8",
    date: "2026-08-07",
    sections: [{ heading: "Changed", items: ["Route Classification now includes routes seen in live AVL data and always allows manual Route ID entry for new special service."] }],
  },
  {
    version: "1.5.7",
    date: "2026-08-07",
    sections: [
      {
        heading: "Changed",
        items: [
          "Missed Trips: the new Trip/Route/Direction table is now an option rather than a replacement. Use the \"List / Table\" toggle next to Flagged trips - List is the original card layout you were already using, Table is the wider view for scanning many rows. Picking a row in Table mode jumps you into List mode with that trip selected.",
        ],
      },
    ],
  },
  {
    version: "1.5.6",
    date: "2026-08-07",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event Monitoring: event buses showed as a bare \"Route 1111\" even when the route had been given a name in Route Classification. The map and table now use that name - e.g. \"Route 1111 · Vikings Game Shuttle\" - so you can tell which shuttle is which at a glance.",
        ],
      },
    ],
  },
  {
    version: "1.5.5",
    date: "2026-08-07",
    sections: [
      {
        heading: "Changed",
        items: [
          "Missed Trips: the flagged-trip list is now a proper table, and identifies each trip the way Avail's own reports do - by scheduled time and direction, like \"1245-SB\" - instead of an opaque internal key like \"t52C-b2E-sl2B-v62\". There's a new Direction column (NB/SB/EB/WB), and the raw reference is still in the detail panel if support needs it.",
        ],
      },
    ],
  },
  {
    version: "1.5.4",
    date: "2026-08-07",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Detours & Closures: no detour was ever showing as Active - everything read \"Recently finished\" no matter its dates, including closures running for months yet. Statuses are now correct everywhere they appear.",
          "Detours & Closures: opening Edit on a detour and saving could clear its start and end dates without warning. The dates now load into the form correctly. If a detour lost its dates recently, that's why - re-enter them and they'll stick.",
          "Detours & Closures: date columns were showing raw timestamps like \"2026-08-08T00:00:00.000Z\" instead of readable dates.",
          "Missed Trips: the investigation queue no longer lists trips that already resolved on their own. Those needed no review and were burying the trips that do; resolved history is still on Monthly Assessments.",
          "Missed Trips: times over an hour now read like \"4h 10m ago\" instead of \"250 min ago\".",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Missed Trips: a newly detected trip now reads \"Potential missed\" in amber until someone reviews it, and only becomes a red \"Missed\" once a reviewer confirms it - a detection is a candidate, not a verdict.",
          "Detour Reports: a \"Created by\" column, and clearer created/last-edited detail on each detour. Detours that came from the Avail sync say so, rather than showing a system account name.",
          "Detours & Closures: the \"Reported by\" and \"Approved by\" lines now appear only when something was actually recorded, instead of showing a row of dashes on every detour.",
        ],
      },
    ],
  },
  {
    version: "1.5.3",
    date: "2026-08-07",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour Reports: a new read-only page under Tools for looking up detour history. Search across closure text, routes, numbers and staff names, filter by status, reason, severity, source or start date, and download whatever you're looking at as a CSV for Excel.",
          "Detours & Closures: new reporting fields on each detour - a reason category, severity, who reported and approved it and when, notes on how it resolved, and checkboxes for radio, dispatch board and social media alongside the existing email flags. All of them are optional; fill them in later if a detour goes up mid-incident.",
          "Detours & Closures: a \"Clone\" button on each detour. It starts a new detour pre-filled with the same closure, routes and reason, but with blank dates and nothing marked as sent - for when one notice covers two closures on different dates.",
          "Detours & Closures: a search box above the table.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "\"Detours & Closures\" has moved down the sidebar into the Tools group, next to the new Detour Reports page.",
          "Reason categories are admin-editable: admins can rename, reorder or retire them without a code change. Retiring one leaves past detours that used it untouched.",
        ],
      },
    ],
  },
  {
    version: "1.5.2",
    date: "2026-08-07",
    sections: [
      {
        heading: "Added",
        items: [
          "Detours & Closures: every new detour now gets an internal reference number in the form MVTA-DET-2026-0001, generated automatically and shown in the list and detail panel. This is separate from the existing free-text Number field, which is unchanged - keep using that for things like \"951\" or \"Operator Message\".",
          "Detours & Closures: a reference number is issued once and never reassigned, so if a detour is later rescheduled into a different year the original number is kept and a note appears explaining why - quote the number as shown, since it may already be in an email that went out.",
          "A new Detour Maintainer role for staff who maintain detour records without needing full publishing access. It can view, create, edit, and attach files to detours, but cannot delete them.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "Compliance users could open Detours & Closures from the sidebar but then saw a \"failed to load\" error, because the page and the data behind it disagreed about who was allowed in. Compliance can now read detour records as intended.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "Deleting a detour is now limited to publishers and admins. Everyone who could delete one before still can.",
        ],
      },
    ],
  },
  {
    version: "1.5.1",
    date: "2026-08-07",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Missed Trips: trips scheduled late at night could never be flagged as no-shows once the date rolled over, so late-evening service was effectively invisible to detection. Those trips are now checked correctly.",
          "Missed Trips: the definition of a missed trip now matches ops' own - never ran, or started more than 30 minutes late (it was 15 minutes before).",
          "Missed Trips: a flagged trip that later showed up was being marked resolved no matter how late it was. It now only clears if it actually arrived within the grace window.",
          "Live AVL vehicle positions had been failing on every single poll since launch and showing no vehicles - the request was built in the wrong shape for the feed. Vehicle positions now load.",
          "Route Classification: classifications can now be removed, not just added and changed.",
          "OTP Compliance: the Historical data backfill tool no longer times out when given a wide date range.",
        ],
      },
      {
        heading: "Added",
        items: [
          "Event Monitoring: a real map overlay showing live bus positions for a monitored event, replacing the placeholder.",
          "Route Classification: a way to see which routes still need classifying, instead of having to work it out by hand.",
        ],
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-06",
    sections: [
      {
        heading: "Added",
        items: [
          "OTP Compliance: a service-month picker, so Route Summary, Review Queue, Monthly Assessments, and Audit Stream can all show an earlier month, not just the current one.",
          "OTP Compliance: an admin \"Historical data backfill\" tool to pull in OTP Monthly and Missed Trips data for months before the feed's normal 3-month rolling window.",
          "OTP Compliance: Review Queue can now copy last month's approve/reject decision for a stop with one click (or all matching stops at once) instead of re-deciding every stop every month.",
          "OTP Compliance: reason codes (Review Queue, Weather exclusions) are now fully admin-editable - rename, reorder, and add, right from the Administration page.",
          "Missed Trips: route and service-date filters on the flagged-trip list.",
          "Missed Trips: the detail view now shows why a trip was flagged - an explicit cancellation vs. a scheduled trip that never showed up.",
          "Missed Trips: a reason-code dropdown alongside investigation notes, so an outcome can be tagged (vehicle breakdown, operator no-show, dispatch error, weather, detection error) instead of only free text.",
          "Missed Trips: a new Monthly Assessments view showing cancellations vs. no-shows and confirmed vs. false-positive counts by month and route.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "OTP Compliance's month labels now read as MM/YYYY instead of a raw number, and the old placeholder \"Service Week\" stat strip is gone.",
          "Missed Trips no longer leads with a cryptic internal trip ID - the flagged-trip list now shows the route and scheduled time first.",
          "Missed Trips no longer offers a \"prepare rider alert\" action - it has been an investigation-only tool since it was introduced, and this leftover control didn't match that.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "OTP Compliance's Monthly and Missed Trips data is now fully live - both feeds were reading the wrong field name from Avail's response and had been showing no data since they launched.",
          "Fixed a data error that had been silently dropping some OTP Monthly rows for stops with longer day-of-week values.",
          "Fixed an \"Internal server error\" that could appear when approving or rejecting a Review Queue candidate.",
        ],
      },
    ],
  },
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
