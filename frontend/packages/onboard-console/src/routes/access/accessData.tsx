import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  ApiError,
  type AccessGrantRequestView,
  type AccessHealthFinding,
  type AccessPersonView,
  type AccessRoleView,
  type OnBoardAccessAuditEntry,
  type OnBoardAccessPrincipal,
  type OnBoardAccessRole,
  type OnBoardDirectoryChange,
} from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";

// Access & Identity is eight pages under one Administration heading, and they
// share one load: who holds access, what is waiting for a decision, the roles
// to choose from and the administrative audit are read once when the section
// opens, so moving between its pages does not re-query.
//
// Since ADR-0032 the answer to "who may do what" is OnBoard's own: people,
// roles and grants come from `/api/manage/access/*`. Entra is still asked
// three things and no more - find a person in the directory, invite a guest,
// and show sign-in activity - so the Entra inventory is still read here for
// the Access groups and Workloads pages and for naming audit targets.
// Access health is a separate read, kept on first visit to that page.

export const HUMAN_ROLES: OnBoardAccessRole[] = [
  "OCC.Viewer",
  "OCC.Publisher",
  "OCC.Detour",
  "OCC.Compliance",
  "OCC.ComplianceManager",
  "OCC.Admin",
  "OCC.AccessAdmin",
];

// Changes to these Entra app roles needed a second, recently signed-in Access
// Administrator. They still describe the legacy assignments the groups and
// workloads pages show.
export const PRIVILEGED_ROLES: readonly string[] = ["OCC.Admin", "OCC.AccessAdmin"];
export const isPrivileged = (role: string) => PRIVILEGED_ROLES.includes(role);

/** Actions in this module are what makes a Role privileged (ADR-0032). */
const ACCESS_ACTION_PREFIX = "access-identity.";

/**
 * Granting or removing one of these is a Privileged Access Change: it needs a
 * second Access Administrator. The rule is the server's; it is repeated here so
 * a page can say so before somebody presses the button, never to decide.
 */
export function isPrivilegedRole(role: Pick<AccessRoleView, "locked" | "actions">): boolean {
  return role.locked || role.actions.some((action) => action.startsWith(ACCESS_ACTION_PREFIX));
}

/** What to call somebody: their name, else their sign-in, else their object id. */
export function personLabel(person: Pick<AccessPersonView, "name" | "email" | "objectId">): string {
  return person.name || person.email || person.objectId;
}

export type PreviewResult = Awaited<ReturnType<typeof api.previewAccessChanges>>;
export type SubmitResult = Awaited<ReturnType<typeof api.submitAccessChanges>>;

export function displayTime(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function displayDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// "in 3 h", "in 2 days", "3 h ago" - for countdowns a reader acts on.
export function relativeTime(value: string, now = Date.now()): string {
  const diff = new Date(value).getTime() - now;
  const abs = Math.abs(diff);
  const hours = abs / 3_600_000;
  const text = hours < 1 ? `${Math.max(1, Math.round(abs / 60_000))} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof ApiError || error instanceof Error ? error.message : fallback;
  if (/request failed \(404\)/i.test(message)) {
    return `We could not reach this Access Management service. Please try again; if it continues, contact an administrator. (${message})`;
  }
  return message;
}

/**
 * The access API answers 503 with a plain message until migrations 129-131 are
 * applied. That is a state of the environment, not a failure of the page, so it
 * is shown as a setup notice rather than as a red error.
 */
export function setupNotice(error: unknown): string | null {
  return error instanceof ApiError && error.status === 503 ? error.message : null;
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function changeLabel(change: Pick<OnBoardDirectoryChange, "action" | "role"> | undefined): string {
  if (!change) return "Access change";
  return `${change.action === "grant" ? "Grant" : change.action === "revoke" ? "Remove" : "Invite"} ${roleLabel(change.role)}`;
}

export function resultLabel(disposition: string): string {
  return ({
    completed: "Applied.",
    pending_approval: "Awaiting approval from another Access Administrator.",
    already_satisfied: "Already assigned.",
    invalid: "Could not be submitted.",
    failed: "Could not be applied.",
  } as Record<string, string>)[disposition] ?? disposition;
}

// Messages from the API name roles by their Entra identifier; people read the
// label. Only whole identifiers are replaced.
export function withRoleLabels(text: string): string {
  return text.replace(/\b(OCC\.[A-Za-z]+|System\.Ingestion)\b/g, (role) => roleLabel(role));
}

export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function initials(name: string): string {
  return name.split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "?";
}

// How the principal's Entra account stands, as one pill.
export function principalAccountStatus(principal: OnBoardAccessPrincipal): { tone: "ok" | "info" | "mute" | "bad"; label: string } {
  if (principal.directory_status === "missing") return { tone: "bad", label: "Missing in Entra" };
  if (principal.account_enabled === false) return { tone: "mute", label: "Disabled in Entra" };
  if (principal.guest_state) return { tone: "info", label: `Guest · ${principal.guest_state}` };
  return { tone: "ok", label: "Enabled" };
}

interface AccessState {
  /** Who OnBoard knows, and what each of them holds (ADR-0032). */
  people: AccessPersonView[];
  /** Privileged changes waiting for a second Access Administrator. */
  requests: AccessGrantRequestView[];
  /** The roles a grant can name. */
  roles: AccessRoleView[];
  /** Set while migrations 129-131 have not been applied here. */
  notReady: string | null;
  /** The Entra inventory, still read for Access groups, Workloads and audit names. */
  principals: OnBoardAccessPrincipal[];
  audit: OnBoardAccessAuditEntry[];
  environment: string;
  accessAdminFallback: boolean;
  loading: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  load: () => Promise<void>;
  findings: AccessHealthFinding[] | null;
  findingsLoading: boolean;
  loadFindings: () => Promise<void>;
  principalName: (id: string) => string;
}

const AccessContext = createContext<AccessState | null>(null);

export function AccessProvider({ children }: PropsWithChildren) {
  const [people, setPeople] = useState<AccessPersonView[]>([]);
  const [requests, setRequests] = useState<AccessGrantRequestView[]>([]);
  const [roles, setRoles] = useState<AccessRoleView[]>([]);
  const [notReady, setNotReady] = useState<string | null>(null);
  const [principals, setPrincipals] = useState<OnBoardAccessPrincipal[]>([]);
  const [audit, setAudit] = useState<OnBoardAccessAuditEntry[]>([]);
  const [environment, setEnvironment] = useState("");
  const [accessAdminFallback, setAccessAdminFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [findings, setFindings] = useState<AccessHealthFinding[] | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.getAccessPeople(),
      api.getAccessGrantRequests(),
      api.getAccessRoles(),
      api.getAccessPrincipals(),
      api.getAccessAudit(),
    ] as const);
    const [peopleResult, requestsResult, rolesResult, inventoryResult, auditResult] = results;
    try {
      // Each list defaults to empty rather than to undefined: a payload without
      // the field - an older API, a proxy returning something else - used to
      // reach a page as `undefined` and crash it, which reads as OnBoard being
      // broken rather than as a list that could not be read.
      if (peopleResult.status === "fulfilled") setPeople(peopleResult.value.people ?? []);
      if (requestsResult.status === "fulfilled") setRequests(requestsResult.value.requests ?? []);
      if (rolesResult.status === "fulfilled") setRoles(rolesResult.value.roles ?? []);
      if (inventoryResult.status === "fulfilled") {
        setPrincipals(inventoryResult.value.principals ?? []);
        setEnvironment(inventoryResult.value.environment);
        setAccessAdminFallback(inventoryResult.value.access_admin_fallback);
      }
      if (auditResult.status === "fulfilled") setAudit(auditResult.value.audit ?? []);

      const rejected = results.filter((result) => result.status === "rejected");
      setNotReady(rejected.map((result) => setupNotice(result.reason)).find(Boolean) ?? null);
      const failed = rejected.find((result) => !setupNotice(result.reason));
      setError(failed ? errorMessage(failed.reason, "Access & Identity could not be loaded.") : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFindings = useCallback(async () => {
    setFindingsLoading(true);
    try {
      setFindings((await api.getAccessHealthFindings()).findings);
      setNotReady(null);
      setError(null);
    } catch (healthError) {
      const setup = setupNotice(healthError);
      if (setup) setNotReady(setup);
      else setError(errorMessage(healthError, "Access health could not be read."));
    } finally {
      setFindingsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const value = useMemo<AccessState>(() => {
    // An audit or inventory row names an Entra object id; a reader wants a name.
    const names = new Map(principals.map((principal) => [principal.id, principal.display_name]));
    for (const person of people) {
      names.set(person.objectId, personLabel(person));
      names.set(person.personId, personLabel(person));
    }
    return {
      people, requests, roles, notReady, principals, audit, environment, accessAdminFallback,
      loading, busy, setBusy, error, setError, notice, setNotice, load,
      findings, findingsLoading, loadFindings,
      principalName: (id: string) => names.get(id) ?? id,
    };
  }, [accessAdminFallback, audit, busy, environment, error, findings, findingsLoading, load, loadFindings, loading, notReady, notice, people, principals, requests, roles]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessState {
  const state = useContext(AccessContext);
  if (!state) throw new Error("useAccess must be used inside AccessProvider");
  return state;
}
