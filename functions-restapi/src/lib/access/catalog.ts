// The module catalog: every module OnBoard shows and the named actions it
// offers. This is the only place either side of the app learns what access
// can exist - endpoints check an action here, the Roles page draws this grid,
// and a role's Access Summary is written from these labels (ADR-0032).
//
// Modules and actions are code because they only change when the app grows a
// capability. Roles, which combine them, are data an Access Administrator
// edits.
//
// Every module has `view`. A module the caller cannot view is hidden from
// navigation and its API refuses the caller, so `view` is never listed among
// a module's own actions below.

export const VIEW = "view";
export const VIEW_LABEL = "View";

export interface ModuleAction {
  key: string;
  label: string;
}

export interface AccessModule {
  key: string;
  label: string;
  /** The navigation section the module lives in, for the Roles grid. */
  section: string;
  /** Actions beyond `view`, in the order the grid shows them. */
  actions: ModuleAction[];
}

export const MODULES: AccessModule[] = [
  { key: "dashboard", label: "Dashboard", section: "Service Operations", actions: [] },
  {
    key: "rider-alerts",
    label: "Rider Alerts",
    section: "Service Operations",
    actions: [{ key: "publish", label: "Compose, edit, retract and approve alerts" }],
  },
  {
    key: "service-risk",
    label: "Service Risk & Quality",
    section: "Service Operations",
    actions: [{ key: "resolve", label: "Resolve on-demand risks" }],
  },
  {
    key: "dispatch-log",
    label: "Dispatch Log",
    section: "Service Operations",
    actions: [{ key: "verify", label: "Record trip-start verifications" }],
  },
  {
    key: "detours",
    label: "Detours & Closures",
    section: "Specialist Operations",
    actions: [
      { key: "edit", label: "Create, edit and close detours" },
      { key: "delete", label: "Delete detours" },
      { key: "intake", label: "Work Detour Intake" },
    ],
  },
  {
    key: "decision-matrix",
    label: "Decision Matrix",
    section: "Specialist Operations",
    actions: [{ key: "manage", label: "Author drafts, governance and the library" }],
  },
  { key: "speed-alerts", label: "Speed Alerts", section: "Specialist Operations", actions: [] },
  {
    key: "event-avl",
    label: "Event AVL",
    section: "Events",
    actions: [
      { key: "message", label: "Send event messages" },
      { key: "notify", label: "Send notifications and run area tests" },
      { key: "configure", label: "Set geofences, locations and vehicle assignments" },
    ],
  },
  {
    key: "event-planning",
    label: "Event Planning",
    section: "Events",
    actions: [{ key: "edit", label: "Author and activate event plans" }],
  },
  {
    key: "compliance-review",
    label: "Compliance Review",
    section: "Compliance & Assessment",
    actions: [{ key: "review", label: "Exclusions, missed-trip validation and departure review" }],
  },
  {
    key: "performance-assessment",
    label: "Performance Assessment",
    section: "Compliance & Assessment",
    actions: [
      { key: "work", label: "Periods, evidence, disputes and draft reports" },
      { key: "decide", label: "Finalize, reopen, issue and decide exceptions" },
    ],
  },
  {
    key: "service-configuration",
    label: "Service Configuration",
    section: "Administration",
    actions: [{ key: "edit", label: "Change service settings, standards and reason codes" }],
  },
  {
    key: "integrations-health",
    label: "Integrations & Data Health",
    section: "Administration",
    actions: [{ key: "edit", label: "Change integration settings" }],
  },
  {
    key: "contractor-performance",
    label: "Contractor Performance setup",
    section: "Administration",
    actions: [{ key: "edit", label: "Maintain contractors, agreements and standards" }],
  },
  { key: "subscribers", label: "Subscribers", section: "Administration", actions: [] },
  { key: "governance-audit", label: "Governance & Audit", section: "Administration", actions: [] },
  {
    key: "access-identity",
    label: "Access & Identity",
    section: "Administration",
    actions: [
      { key: "manage", label: "Grant access and edit roles" },
      { key: "approve", label: "Approve privileged access changes" },
    ],
  },
];

/** `detours.delete`. The one spelling an endpoint, a grant and the grid share. */
export function actionKey(module: string, action: string): string {
  return `${module}.${action}`;
}

const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export function findModule(moduleKey: string): AccessModule | undefined {
  return MODULE_BY_KEY.get(moduleKey);
}

export function moduleActionKeys(module: AccessModule): string[] {
  return [actionKey(module.key, VIEW), ...module.actions.map((a) => actionKey(module.key, a.key))];
}

export function allActionKeys(): string[] {
  return MODULES.flatMap(moduleActionKeys);
}

/**
 * Every action outside Access & Identity. System Administrator holds these,
 * including actions added after it was seeded, which is why it is stored as a
 * flag rather than a list of rows (ADR-0032). Managing access stays a separate
 * authority.
 */
export const ACCESS_MODULE = "access-identity";

export function allActionKeysExceptAccess(): string[] {
  return MODULES.filter((m) => m.key !== ACCESS_MODULE).flatMap(moduleActionKeys);
}

export function isKnownAction(key: string): boolean {
  const [moduleKey, action] = key.split(".");
  const module = moduleKey ? MODULE_BY_KEY.get(moduleKey) : undefined;
  if (!module) return false;
  return action === VIEW || module.actions.some((a) => a.key === action);
}

export function actionLabel(key: string): string | undefined {
  const [moduleKey, action] = key.split(".");
  const module = moduleKey ? MODULE_BY_KEY.get(moduleKey) : undefined;
  if (!module) return undefined;
  if (action === VIEW) return VIEW_LABEL;
  return module.actions.find((a) => a.key === action)?.label;
}

/**
 * The Access Summary: one line per module the holder can see, in catalog
 * order. It is generated from the grid on every read rather than stored, so a
 * role's description cannot drift from what the role actually grants - the
 * drift that made the old Entra role lists untrustworthy.
 *
 * A module granted an action without `view` still gets a line, marked, because
 * that combination is a mistake worth seeing on the page.
 */
export function accessSummaryLines(actionKeys: Iterable<string>): string[] {
  const held = new Set(actionKeys);
  const lines: string[] = [];
  for (const module of MODULES) {
    const canView = held.has(actionKey(module.key, VIEW));
    const actions = module.actions.filter((a) => held.has(actionKey(module.key, a.key)));
    if (!canView && actions.length === 0) continue;
    const labels = actions.map((a) => a.label);
    if (!canView) {
      lines.push(`${module.label}: ${labels.join("; ")} (cannot open the page)`);
    } else if (labels.length === 0) {
      lines.push(`${module.label}: view only`);
    } else {
      lines.push(`${module.label}: view; ${labels.join("; ")}`);
    }
  }
  return lines;
}
