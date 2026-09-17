import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  ApiError,
  type OnBoardAccessAuditEntry,
  type OnBoardAccessChangeRecord,
  type OnBoardAccessMetadata,
  type OnBoardAccessPrincipal,
  type OnBoardAccessReconciliationReport,
  type OnBoardAccessRole,
  type OnBoardDirectoryChange,
} from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";

// Access & Identity used to be one page with seven tabs. It is now seven
// pages under one Administration heading, and they share one load: the
// inventory, the approval queue, due expiries and the audit trail are read
// once when the section opens, so moving between its pages does not re-query
// Entra. Access health is the exception - it reads Entra live and costs a
// Graph sweep - so it is fetched on first visit to that page and kept.

export const HUMAN_ROLES: OnBoardAccessRole[] = [
  "OCC.Viewer",
  "OCC.Publisher",
  "OCC.Detour",
  "OCC.Compliance",
  "OCC.ComplianceManager",
  "OCC.Admin",
  "OCC.AccessAdmin",
];

// Changes to these need a second, recently signed-in Access Administrator.
export const PRIVILEGED_ROLES: readonly string[] = ["OCC.Admin", "OCC.AccessAdmin"];
export const isPrivileged = (role: string) => PRIVILEGED_ROLES.includes(role);

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

export function needsAttention(principal: OnBoardAccessPrincipal): boolean {
  return principal.directory_status === "missing"
    || principal.account_enabled === false
    || principal.assignments.some((assignment) => assignment.source === "direct" && principal.principal_type === "user")
    || principal.assignments.some((assignment) => assignment.lifecycle_status === "expiry_failed");
}

interface AccessState {
  principals: OnBoardAccessPrincipal[];
  pending: OnBoardAccessChangeRecord[];
  expirations: OnBoardAccessMetadata[];
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
  load: (afterSubmission?: boolean) => Promise<void>;
  reconciliation: OnBoardAccessReconciliationReport | null;
  reconciliationLoading: boolean;
  loadReconciliation: () => Promise<void>;
  principalName: (id: string) => string;
}

const AccessContext = createContext<AccessState | null>(null);

export function AccessProvider({ children }: PropsWithChildren) {
  const [principals, setPrincipals] = useState<OnBoardAccessPrincipal[]>([]);
  const [pending, setPending] = useState<OnBoardAccessChangeRecord[]>([]);
  const [expirations, setExpirations] = useState<OnBoardAccessMetadata[]>([]);
  const [audit, setAudit] = useState<OnBoardAccessAuditEntry[]>([]);
  const [environment, setEnvironment] = useState("");
  const [accessAdminFallback, setAccessAdminFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<OnBoardAccessReconciliationReport | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);

  const load = useCallback(async (afterSubmission = false) => {
    setLoading(true);
    const [accessResult, changesResult, expiryResult, auditResult] = await Promise.allSettled([
      api.getAccessPrincipals(),
      api.getPendingAccessChanges(),
      api.getAccessExpirations(),
      api.getAccessAudit(),
    ] as const);
    try {
      if (accessResult.status === "fulfilled") {
        setPrincipals(accessResult.value.principals);
        setEnvironment(accessResult.value.environment);
        setAccessAdminFallback(accessResult.value.access_admin_fallback);
      }
      if (changesResult.status === "fulfilled") setPending(changesResult.value.changes);
      if (expiryResult.status === "fulfilled") setExpirations(expiryResult.value.expirations);
      if (auditResult.status === "fulfilled") setAudit(auditResult.value.audit);
      const failed = [accessResult, changesResult, expiryResult, auditResult].find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        setError(afterSubmission
          ? "The access request was saved, but live Microsoft Entra data could not be refreshed. Do not submit it again."
          : errorMessage(failed.reason, "Access Management could not be loaded."));
      } else {
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReconciliation = useCallback(async () => {
    setReconciliationLoading(true);
    try {
      setReconciliation(await api.getAccessReconciliation());
      setError(null);
    } catch (reconcileError) {
      setError(errorMessage(reconcileError, "Access reconciliation failed."));
    } finally {
      setReconciliationLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const value = useMemo<AccessState>(() => {
    const names = new Map(principals.map((principal) => [principal.id, principal.display_name]));
    return {
      principals, pending, expirations, audit, environment, accessAdminFallback, loading, busy, setBusy,
      error, setError, notice, setNotice, load, reconciliation, reconciliationLoading, loadReconciliation,
      principalName: (id: string) => names.get(id) ?? id,
    };
  }, [accessAdminFallback, audit, busy, environment, error, expirations, load, loadReconciliation, loading, notice, pending, principals, reconciliation, reconciliationLoading]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessState {
  const state = useContext(AccessContext);
  if (!state) throw new Error("useAccess must be used inside AccessProvider");
  return state;
}
