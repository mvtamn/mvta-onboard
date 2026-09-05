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
    version: "1.5.96",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Dispatch Log groundwork: a nightly trip-start log is now built for today and tomorrow from the GTFS schedule, with each trip's weekly verification-rotation day, and can be read per service date. Actual start times and the console module follow in later steps.",
        ],
      },
    ],
  },
  {
    version: "1.5.95",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Likely-duplicate and conflict warnings now recognise two Detours that touch the same GTFS stop, from the map drawing or the stops added from it, and name the shared stops.",
        ],
      },
    ],
  },
  {
    version: "1.5.94",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Likely-duplicate and conflict warnings now recognise two Detours drawn at the same place on the map, whatever they were called or which routes were typed.",
        ],
      },
    ],
  },
  {
    version: "1.5.93",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Emailed Detour communications now show a per-recipient delivery receipt from the mail provider - Delivered, Bounced, Suppressed, Filtered as spam - and a communication reads Delivered only once every recipient is confirmed, with Accepted by provider until then.",
        ],
      },
    ],
  },
  {
    version: "1.5.92",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour Reports shows each Detour's communications with delivery state and a Sent copy of exactly what went out; the same Sent copy appears on Detours & Closures.",
        ],
      },
    ],
  },
  {
    version: "1.5.91",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour communications on the Teams channel can be posted from the server with Post to Teams; the post shows as Posted or names the failure, with Retry send.",
        ],
      },
    ],
  },
  {
    version: "1.5.90",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour communications can be sent by email from the server. Send email freezes exactly what goes out, shows Sending, Delivered, or the failing addresses on the communication, and offers Retry send; Open in email and Mark published (sent elsewhere) remain for manual sends.",
        ],
      },
    ],
  },
  {
    version: "1.5.89",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour Intake has a map: draw the closure as a point, line, or area, find the GTFS stops within a chosen distance, and add them and their routes to the intake in one step. The drawing stays with the Detour and shows on Detours & Closures and Detour Reports.",
        ],
      },
    ],
  },
  {
    version: "1.5.88",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detours & Closures warns when a Detour overlaps another open Detour on the same route or place in the same window, and requires a recorded reason to proceed before the Avail entry can be confirmed. The reason and the conflicting Detours stay in the workflow history; Detour Reports shows and exports the conflict state.",
        ],
      },
    ],
  },
  {
    version: "1.5.87",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Contractor notification for Detours: Administration holds the fixed-route contractor's name and email recipients; once set, every fixed-route Detour lists the contractor as a required audience, Draft prefills the recipients, Open in email hands the message to your mail client, and marking it published records who it went to.",
        ],
      },
    ],
  },
  {
    version: "1.5.86",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour communications now start from the record: a checklist of the audiences the intake required with their progress, a Draft button per audience that fills in audience, channel, and a message built from the Detour's details, and audience and channel choices limited to what the record names.",
        ],
      },
    ],
  },
  {
    version: "1.5.85",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "PDFs and documents attached to a Detour now show as a file tile that opens the document instead of a broken image, and can be attached after acceptance. Detour Reports shows a Detour's attachments read-only.",
        ],
      },
    ],
  },
  {
    version: "1.5.84",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "The Detour Intake list no longer fails on an environment that is missing one of its optional migrations; it omits those columns instead.",
        ],
      },
    ],
  },
  {
    version: "1.5.83",
    date: "2026-09-04",
    sections: [
      {
        heading: "Added",
        items: [
          "Detour Intake warns OCC about likely duplicates: open Detours and other open intake reports that share a route number or a street/landmark name inside an overlapping operating window. The review dialog lists them with what they share, and Mark duplicate of this fills the target in one click. Nothing is merged or rejected automatically.",
        ],
      },
    ],
  },
  {
    version: "1.5.82",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "The legacy spreadsheet import on Detour Reports now reads real Excel CSVs: quoted commas, embedded quotes and line breaks, a BOM, and columns in any order matched by header name. It reports rows skipped for missing closure text and columns it kept but did not recognise, and a Detour Reports export can be re-imported intact.",
        ],
      },
    ],
  },
  {
    version: "1.5.81",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Detour Reports now lists the legacy spreadsheet rows that have been imported, grouped by source file, and the search box reaches them. The import control appears only for staff who can record detours, instead of failing silently for read-only roles.",
        ],
      },
    ],
  },
  {
    version: "1.5.80",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Accepting a Detour Intake no longer files the closure location as Riders directed. The Detour now carries its own Location, shown in the operational record and exported in the Reports CSV; existing promoted Detours are corrected by migration 088.",
        ],
      },
    ],
  },
  {
    version: "1.5.79",
    date: "2026-09-03",
    sections: [
      {
        heading: "Added",
        items: [
          "Detours & Closures and Detour Reports show each Detour's workflow history - creation, workflow transitions, Avail observations, corrections, and fulfillment confirmation - behind a Show history control.",
          "Administration can now manage Detour reason categories: add a code, relabel or reorder it, and retire it without losing the history that used it.",
        ],
      },
    ],
  },
  {
    version: "1.5.78",
    date: "2026-09-03",
    sections: [
      {
        heading: "Fixed",
        items: [
          "The Detour Reports CSV now carries every column the table shows - path, readiness, next owner, communications, workflow, closure reason, and Avail entry details - in the same order as the page.",
        ],
      },
    ],
  },
  {
    version: "1.5.77",
    date: "2026-09-03",
    sections: [
      {
        heading: "Fixed",
        items: [
          "A Detour flagged for OCC re-review after an edit can now be cleared. Mark review complete sits beside the warning on Detours & Closures, records who reviewed it in the workflow history, and Detour Reports shows and exports the flag.",
        ],
      },
    ],
  },
  {
    version: "1.5.76",
    date: "2026-09-03",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Detour Intake reports returned for information no longer disappear. They appear under a Needs information tab with OCC's request, can be updated and resubmitted for review, and can still be withdrawn, rejected, or marked duplicate. Pending reports can be edited in place, and decided reports are listed with their outcome.",
        ],
      },
    ],
  },
  {
    version: "1.5.75",
    date: "2026-09-03",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Detours & Closures and Detour Reports now show the operational record an accepted intake carries — operating window, service impact, affected stops, action instructions, required audiences and channels, confirmation contact, and evidence. Search reaches these fields and the Reports CSV exports them.",
        ],
      },
    ],
  },
  {
    version: "1.5.74",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Garage-departure occurrences now cover the runs that never left the garage. The rule was looking for a status the feed never sends, and missed more than four hundred runs with no recorded departure. Statuses describing a bus returning to the garage can no longer be counted as departure failures, and a run the source has not finished classifying is left alone.",
        ],
      },
    ],
  },
  {
    version: "1.5.73",
    date: "2026-09-04",
    sections: [
      {
        heading: "Changed",
        items: [
          "A garage departure now becomes a reviewable occurrence only when the bus never left the garage or left more than ten minutes late, rather than whenever Avail marked the pullout window elapsed. Each occurrence says which of the two it was, so the Occurrence Log can be triaged at a glance.",
          "Garage-departure occurrences already raised under the previous rule are cleared from the Occurrence Log where the record shows the bus departed acceptably, each one keeping a note of why it was dismissed. Occurrences somebody has already reviewed are left as they are.",
        ],
      },
    ],
  },
  {
    version: "1.5.72",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Feed health across every ingestion feed now reflects what each poll actually recorded rather than what the source returned, so a poll that stores nothing is reported as a failure instead of a healthy run at full volume.",
          "A vehicle-position poll that records no operational evidence no longer counts as proof that trip-start coverage was available, so trips with no evidence wait for data instead of being treated as no-shows.",
          "A missed-trip reload whose reports cannot be read no longer erases the months it was refreshing; the retained evidence is kept and the run is reported as a failure.",
        ],
      },
      {
        heading: "Changed",
        items: [
          "The two pollers that read the GTFS-RT trip update feed now record its health once, through one shared reader, instead of each writing the same trust record and overwriting the other.",
        ],
      },
    ],
  },
  {
    version: "1.5.71",
    date: "2026-09-04",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Fixed Route Departures now records each run against the agency service day it belongs to. Evening polls previously filed a run under the next calendar day, so the same run could appear twice and be counted twice in the late and expired pullout totals.",
          "Fixed Route Departures no longer shows a zeroed summary under a \"Live data\" badge when its feed is not connected. An unconfigured feed, a missing history table, and an unreachable service now read as three distinct states, and the pullout counts are withheld until the source can actually support them.",
        ],
      },
    ],
  },
  {
    version: "1.5.70",
    date: "2026-08-28",
    sections: [
      {
        heading: "Changed",
        items: [
          "The shared feed-health ledger behind KPI trust is now named KpiFeedHealth rather than MissedTripFeedHealth, since every KPI stream depends on it.",
        ],
      },
    ],
  },
  {
    version: "1.5.69",
    date: "2026-08-28",
    sections: [
      {
        heading: "Changed",
        items: [
          "An On-Demand request that is neither overdue nor forecast past its standard now reads \"Within standard\" instead of Watch, so the Watch label carries one meaning.",
          "The Fixed Route and On-Demand workspaces now share one training-scenario toggle, actions-unavailable rule, and stale-data acknowledgement prompt, and KPI trust states read identically in the Admin feed-health view.",
        ],
      },
    ],
  },
  {
    version: "1.5.68",
    date: "2026-08-28",
    sections: [
      {
        heading: "Changed",
        items: [
          "On-Demand records are now named requests rather than trips, in both the workspace labels and the underlying data contract, matching the Active on-demand request terminology.",
        ],
      },
    ],
  },
  {
    version: "1.5.67",
    date: "2026-08-27",
    sections: [
      {
        heading: "Fixed",
        items: [
          "A feed run that completed successfully with no qualifying records now reports as covered rather than unavailable, so a quiet period no longer blocks preparing a customer update.",
        ],
      },
    ],
  },
  {
    version: "1.5.66",
    date: "2026-08-27",
    sections: [
      {
        heading: "Changed",
        items: [
          "The top bar no longer shows a single console-wide data status; each workspace states its own health where the data is used.",
          "Fixed-route and Spare missed-trip KPI trust now list Avail Missed Trips as supporting retrospective evidence, visible without gating either stream.",
        ],
      },
    ],
  },
  {
    version: "1.5.65",
    date: "2026-08-27",
    sections: [
      {
        heading: "Fixed",
        items: [
          "A stale-data acknowledgement is now recorded when a communication is prepared, under the name of the staff member who used the stale data, instead of at approval under the reviewer's name.",
          "An On-Demand request whose pickup commitment has passed now reads as Overdue rather than Watch, keeping an observed condition distinct from a forecast one.",
        ],
      },
    ],
  },
  {
    version: "1.5.64",
    date: "2026-08-27",
    sections: [
      {
        heading: "Fixed",
        items: [
          "On-Demand KPI trust is now established by the hourly authoritative reconciliation, so it no longer depends on the separately enabled Spare missed-trip ingestion. Spare Requests and Slots remain supporting evidence.",
          "Preparing a Suggested Alert from a Current-but-empty KPI stream no longer asks for a stale-data reason, which the review endpoint rejected.",
        ],
      },
    ],
  },
  {
    version: "1.5.63",
    date: "2026-08-27",
    sections: [
      {
        heading: "Improved",
        items: [
          "Event AVL Status queue delivery now uses a short-lived claim, preventing concurrent operator and retry deliveries from posting the same Teams notification twice.",
          "The queue shows an in-progress delivery and keeps pending, acknowledged, in-progress, and failed work in the operational count until it reaches a terminal outcome.",
        ],
      },
    ],
  },
  {
    version: "1.5.62",
    date: "2026-08-24",
    sections: [
      {
        heading: "Improved",
        items: [
          "Every detected Monitoring Area entry or exit now creates a Status queue item; unmatched crossings stay available for manual review and cannot auto-send to Teams.",
          "Event AVL vehicle identity now leads with the display label, for example State Fair Shuttle: Route 444 (Vehicle 4522), including vehicle views, map popups, crossing history, and new queue messages.",
        ],
      },
    ],
  },
  {
    version: "1.5.61",
    date: "2026-08-24",
    sections: [
      {
        heading: "Improved",
        items: [
          "Route Classification now provides a color picker for each route, and Event AVL uses that color for every live bus marker assigned to the route.",
          "Configured route display labels appear throughout Event AVL, including vehicle views, map popups and accessibility labels, search, and newly created status-queue messages.",
          "The critical in-app queue is now explicitly labeled Status queue and remains available when automatic Teams delivery is off; the Teams setting controls external delivery only.",
        ],
      },
    ],
  },
  {
    version: "1.5.60",
    date: "2026-08-24",
    sections: [
      {
        heading: "Improved",
        items: [
          "Open field window now launches the focused Event AVL view in a separate browser window with the selected Event and operating period preserved, leaving the original console free for other work.",
        ],
      },
    ],
  },
  {
    version: "1.5.59",
    date: "2026-08-24",
    sections: [
      {
        heading: "Improved",
        items: [
          "The larger Event AVL map now expands inside OnBoard and keeps vehicles, selection, Monitoring Areas, locations, traffic, map style, zoom, and compass controls.",
          "Selected vehicle details now lead with a labeled route and vehicle pair, show Monitoring Area context once, and clearly label report freshness.",
          "The focused Event AVL field route now retains the Event AVL page title instead of falling back to Dashboard.",
        ],
      },
    ],
  },
  {
    version: "1.5.55",
    date: "2026-08-22",
    sections: [
      {
        heading: "Changed",
        items: [
          "Open Event notifications are a count badge in the Event AVL context bar that opens a queue drawer, rather than a panel above the map. This replaces the arrangement described in 1.5.47: the work waiting on you stays visible from every scroll position without the map losing the first viewport. Pending, acknowledged, and failed notifications all remain in the open queue, so a failed delivery is still retryable.",
        ],
      },
    ],
  },
  {
    version: "1.5.54",
    date: "2026-08-22",
    sections: [
      {
        heading: "Improved",
        items: [
          "Release notes now use a clearer, more scannable layout with a prominent current-build indicator and refined expandable release cards.",
        ],
      },
    ],
  },
  {
    version: "1.5.49",
    date: "2026-08-22",
    sections: [
      {
        heading: "Fixed",
        items: [
          "The Changelog page and \"What's new\" popover were missing the 1.5.46 and 1.5.47 releases. Both are listed again.",
        ],
      },
    ],
  },
  {
    version: "1.5.48",
    date: "2026-08-22",
    sections: [
      {
        heading: "Added",
        items: [
          "The side navigation can now be collapsed to an icon-only rail and expanded again from the control beside the OnBoard logo. Your choice is remembered between visits, every link stays reachable while collapsed, and hovering an icon shows its name.",
        ],
      },
    ],
  },
  {
    version: "1.5.47",
    date: "2026-08-20",
    sections: [
      {
        heading: "Improved",
        items: [
          "Event AVL now leads with the open notification queue above the vehicle map, so the work waiting on you comes before the map rather than after it.",
        ],
      },
    ],
  },
  {
    version: "1.5.46",
    date: "2026-08-16",
    sections: [
      {
        heading: "Improved",
        items: [
          "Administration is now a management workspace with its own navigation for access, Event resources, service configuration, integrations, governance, and subscribers. Event Planning and Event AVL are grouped under a dedicated Events workspace; existing links still work.",
        ],
      },
      {
        heading: "Fixed",
        items: [
          "Administration no longer opens a landing page that just repeated its own menu - it goes straight to Service Configuration.",
          "The Administration heading no longer appears twice in the sidebar.",
        ],
      },
    ],
  },
  {
    version: "1.5.43",
    date: "2026-08-16",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event Planning now rejects self-intersecting geofence polygons before save, restores the previous boundary after an invalid edit, and keeps the map available for another attempt.",
        ],
      },
    ],
  },
  {
    version: "1.5.42",
    date: "2026-08-15",
    sections: [
      {
        heading: "Improved",
        items: [
          "Event Planning now supports departing, passed, arriving-soon, and custom geofence message types; Event AVL now controls automatic Teams delivery for the selected active operating period.",
        ],
      },
    ],
  },
  {
    version: "1.5.41",
    date: "2026-08-15",
    sections: [
      {
        heading: "Improved",
        items: [
          "Every crossing in an active operating scope now creates an Event AVL queue item, while completed Teams deliveries are separated into investigative history.",
        ],
      },
    ],
  },
  {
    version: "1.5.40",
    date: "2026-08-15",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event crossings and notifications now retain the AVL route ID alongside the bus number.",
          "Administrators can remove geofences by deactivating them from the resource list.",
        ],
      },
    ],
  },
  {
    version: "1.5.39",
    date: "2026-08-15",
    sections: [
      {
        heading: "Improved",
        items: [
          "Operating periods now use separate local date/time fields and resource selection uses searchable checkboxes.",
          "Direction rules are organized into matching, movement, and message steps with compass presets, clearer delivery labels, and an Event AVL message preview.",
        ],
      },
    ],
  },
  {
    version: "1.5.38",
    date: "2026-08-15",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event AVL now projects every fresh AVL vehicle so vehicles outside active service-plan scope populate the unassigned queue.",
        ],
      },
    ],
  },
  {
    version: "1.5.37",
    date: "2026-08-15",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Event AVL now identifies an expired sign-in and provides a direct Sign in again action instead of remaining in a misleading loading state.",
        ],
      },
    ],
  },
  {
    version: "1.5.36",
    date: "2026-08-15",
    sections: [
      {
        heading: "Fixed",
        items: [
          "Authenticated GET requests now refresh the Entra access token once after a 401 response before showing a feed error.",
        ],
      },
    ],
  },
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
