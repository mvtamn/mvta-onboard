import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type FeedCheck, type OnBoardAccessChangeRecord, type OnBoardAccessMetadata } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";

type Card = { to: string; title: string; description: string; status: string; tone: "good" | "warn" | "danger" };

function feedStatus(checks: FeedCheck[] | null): { status: string; tone: Card["tone"] } {
  if (!checks) return { status: "Not checked", tone: "warn" };
  const failed = checks.filter((check) => check.error || !check.status || check.status >= 400);
  return failed.length ? { status: `${failed.length} issue${failed.length === 1 ? "" : "s"}`, tone: "danger" } : { status: "Healthy", tone: "good" };
}

export function AdminOverview() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("OCC.Admin");
  const canManageAccess = isAdmin || roles.includes("OCC.AccessAdmin");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<OnBoardAccessChangeRecord[]>([]);
  const [expirations, setExpirations] = useState<OnBoardAccessMetadata[]>([]);
  const [checks, setChecks] = useState<FeedCheck[] | null>(null);
  const [recentChange, setRecentChange] = useState<string | null>(null);

  useEffect(() => {
    if (canManageAccess) {
      void Promise.allSettled([api.getPendingAccessChanges(), api.getAccessExpirations(), api.getAccessAudit()]).then(([changes, expiry, audit]) => {
        if (changes.status === "fulfilled") setPending(changes.value.changes.filter((change) => change.status === "pending"));
        if (expiry.status === "fulfilled") setExpirations(expiry.value.expirations.filter((item) => item.status === "expiring"));
        if (audit.status === "fulfilled") setRecentChange(audit.value.audit[0]?.action ?? null);
      });
    }
    if (isAdmin) void api.getFeedChecks().then((result) => setChecks(result.checks)).catch(() => setChecks(null));
  }, [canManageAccess, isAdmin]);

  const cards = useMemo<Card[]>(() => {
    const feed = feedStatus(checks);
    return [
      ...(canManageAccess ? [{ to: "/admin/access", title: "Access & Identity", description: "People, groups, workloads, onboarding, approvals, expirations, and reconciliation.", status: pending.length ? `${pending.length} approval${pending.length === 1 ? "" : "s"} pending` : "Current", tone: pending.length ? "warn" : "good" as const }] : []),
      ...(isAdmin ? [
        { to: "/admin/events", title: "Event Administration", description: "Reusable geofences, locations, direction rules, route classification, and Event settings.", status: "Resource catalog", tone: "good" as const },
        { to: "/admin/service", title: "Service Configuration", description: "Service Alert defaults and operational business rules.", status: "Current", tone: "good" as const },
        { to: "/admin/integrations", title: "Integrations & Data Health", description: "Feed status, polling intervals, delivery, maps, storage, and retention.", status: feed.status, tone: feed.tone },
        { to: "/admin/governance", title: "Governance & Audit", description: "Administrative changes, access audit, event history, and configuration history.", status: recentChange ? `Last: ${recentChange}` : "Available", tone: "good" as const },
      ] : []),
      ...(canManageAccess ? [{ to: "/admin/subscribers", title: "Subscribers", description: "Review subscriber totals, signup activity, and communication audience data.", status: "Current", tone: "good" as const }] : []),
    ] as Card[];
  }, [canManageAccess, checks, isAdmin, pending.length, recentChange]);

  const visibleCards = cards.filter((card) => !query.trim() || `${card.title} ${card.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const attention = pending.length || expirations.length || (checks && feedStatus(checks).tone === "danger");

  return <>
    <div className="admin-page-heading">
      <div><span className="admin-eyebrow">Administration</span><h2>Overview</h2><p>Manage access, reusable resources, system configuration, integrations, and governance.</p></div>
      <input className="admin-search" aria-label="Search administration" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search administration" />
    </div>
    {attention ? <div className="admin-attention" role="status"><strong>Needs attention:</strong> {pending.length ? `${pending.length} privileged access approval${pending.length === 1 ? "" : "s"}` : expirations.length ? `${expirations.length} access assignment${expirations.length === 1 ? "" : "s"} require review` : "Feed health requires investigation"}. <Link to={pending.length ? "/admin/access" : "/admin/integrations"}>Review →</Link></div> : null}
    <div className="admin-module-grid">
      {visibleCards.map((card) => <Link className="admin-module-card" to={card.to} key={card.to}><h3>{card.title}</h3><p>{card.description}</p><span className={`admin-card-status ${card.tone}`}>{card.status}</span><span className="admin-card-link">Open module →</span></Link>)}
      {visibleCards.length === 0 ? <p className="empty-note">No administration modules match “{query}”.</p> : null}
    </div>
    {!isAdmin && canManageAccess ? <p className="muted admin-scope-note">Your view is limited to access management and governance areas assigned to your role.</p> : null}
  </>;
}

export function AdminOverviewError(error: unknown): string {
  return error instanceof ApiError ? error.message : "Administration overview is unavailable.";
}
