// The nine roles OnBoard starts with, and the Entra app roles they replace.
//
// Each one is written from what the role is for, not copied from the role sets
// it replaces, because those had drifted: Compliance Manager could open the
// Compliance pages but its data calls refused it, Access Administrator was
// refused by its own Subscribers and Governance pages, and two roles could not
// be granted from the console at all. Seeding from intent fixes all of that in
// one place.
//
// Migration 129 inserts the same nine rows and only when they are missing, so
// an Access Administrator's later edits survive a re-run. The contract test
// fails if the SQL and this file disagree.
import { ACCESS_MODULE, actionKey, MODULES, VIEW } from "./catalog";

export interface SeededRole {
  key: string;
  name: string;
  /** The admin-editable purpose line. The Access Summary is generated, not this. */
  purpose: string;
  /** Locked roles cannot be edited or deleted, so nobody can lock themselves out. */
  locked?: boolean;
  /** Holds every action outside Access & Identity, including future ones. */
  allActions?: boolean;
  actions: string[];
}

const view = (...modules: string[]) => modules.map((m) => actionKey(m, VIEW));

// Viewer's read, which Publisher also holds. Compliance Review and Performance
// Assessment are in it because the API already let these roles read that data;
// they now get a page for it instead of access no screen exposed (2026-09-17).
const VIEWER_ACTIONS = view(
  "dashboard",
  "rider-alerts",
  "service-risk",
  "dispatch-log",
  "detours",
  "decision-matrix",
  "event-avl",
  "compliance-review",
  "performance-assessment",
);

const COMPLIANCE_ANALYST_ACTIONS = [
  ...view("compliance-review", "performance-assessment", "detours", "dispatch-log"),
  actionKey("compliance-review", "review"),
  actionKey("performance-assessment", "work"),
];

export const SEEDED_ROLES: SeededRole[] = [
  {
    key: "viewer",
    name: "Viewer",
    purpose: "Reads operations without changing anything.",
    actions: VIEWER_ACTIONS,
  },
  {
    key: "publisher",
    name: "Publisher",
    purpose: "Runs day-to-day service communications and detours.",
    actions: [
      ...VIEWER_ACTIONS,
      actionKey("rider-alerts", "publish"),
      actionKey("service-risk", "resolve"),
      actionKey("detours", "edit"),
      actionKey("detours", "delete"),
      actionKey("event-avl", "notify"),
    ],
  },
  {
    key: "detour-editor",
    name: "Detour Editor",
    purpose: "Records and maintains detours, and nothing else.",
    actions: [...view("detours"), actionKey("detours", "edit")],
  },
  {
    key: "event-avl-operator",
    name: "Event AVL Operator",
    purpose: "Monitors events and sends event messages and notifications.",
    actions: [
      ...view("dashboard", "rider-alerts", "event-avl"),
      actionKey("event-avl", "message"),
      actionKey("event-avl", "notify"),
    ],
  },
  {
    key: "compliance-analyst",
    name: "Compliance Analyst",
    purpose: "Reviews service compliance and prepares performance assessments.",
    actions: COMPLIANCE_ANALYST_ACTIONS,
  },
  {
    key: "compliance-manager",
    name: "Compliance Manager",
    purpose: "Decides assessments: finalizing, reopening, issuing and exceptions.",
    actions: [...COMPLIANCE_ANALYST_ACTIONS, actionKey("performance-assessment", "decide")],
  },
  {
    key: "trip-start-verifier",
    name: "Trip Start Verifier",
    purpose: "Reads the Dispatch Log and records trip-start verifications.",
    actions: [...view("dispatch-log"), actionKey("dispatch-log", "verify")],
  },
  {
    key: "system-administrator",
    name: "System Administrator",
    purpose: "Operates and configures everything except access itself.",
    locked: true,
    allActions: true,
    actions: [],
  },
  {
    key: "access-administrator",
    name: "Access Administrator",
    purpose: "Grants OnBoard access, edits roles and approves privileged changes.",
    locked: true,
    actions: [
      ...view(ACCESS_MODULE, "subscribers", "governance-audit"),
      actionKey(ACCESS_MODULE, "manage"),
      actionKey(ACCESS_MODULE, "approve"),
    ],
  },
];

/**
 * The Entra app role each seeded role replaces. Until the cutover (increment 6)
 * the resolver reads these as well, so access keeps working in every
 * environment between deploying the code and granting people their roles here.
 * `System.Ingestion` is deliberately absent: workload identities have no person
 * record and keep their app role for good (ADR-0032).
 */
export const LEGACY_APP_ROLE_TO_ROLE_KEY: Record<string, string> = {
  "OCC.Viewer": "viewer",
  "OCC.Publisher": "publisher",
  "OCC.Detour": "detour-editor",
  "OCC.EventAVL": "event-avl-operator",
  "OCC.Compliance": "compliance-analyst",
  "OCC.ComplianceManager": "compliance-manager",
  "OCC.TripStartVerify": "trip-start-verifier",
  "OCC.Admin": "system-administrator",
  "OCC.AccessAdmin": "access-administrator",
};

export const INGESTION_APP_ROLE = "System.Ingestion";

export function seededRole(key: string): SeededRole | undefined {
  return SEEDED_ROLES.find((r) => r.key === key);
}

/** Guards the seeds against a typo the catalog would never accept. */
export function unknownSeededActions(): string[] {
  const known = new Set(MODULES.flatMap((m) => [actionKey(m.key, VIEW), ...m.actions.map((a) => actionKey(m.key, a.key))]));
  return SEEDED_ROLES.flatMap((r) => r.actions).filter((a) => !known.has(a));
}
