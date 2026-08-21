import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";
import { isDepartureAtRisk } from "@mvta/shared";
import type { LiveStats } from "../hooks/useLiveStats.js";
import { hasServiceRiskAccess } from "./ServiceOperations.js";

export function ServiceOperationsOverview({ stats }: { stats: LiveStats }) {
  const { roles } = useAuth();
  const pendingCount = stats.pending?.length ?? null;
  const canSeeServiceRisk = hasServiceRiskAccess(roles);
  const [riskSummary, setRiskSummary] = useState<{ fixedRoute: number; onDemand: number } | null>(null);

  useEffect(() => {
    if (!canSeeServiceRisk) return;
    let alive = true;
    Promise.allSettled([api.getTripDelays(), api.getOnDemandRisks()]).then(([fixedRoute, onDemand]) => {
      if (!alive) return;
      const fixedRouteCount = fixedRoute.status === "fulfilled"
        ? fixedRoute.value.delays.filter(isDepartureAtRisk).length
        : null;
      const onDemandCount = onDemand.status === "fulfilled"
        ? onDemand.value.risks.filter((risk) => risk.current_wait_minutes > 25 || (risk.predicted_wait_minutes ?? 0) > 25).length
        : null;
      if (fixedRouteCount !== null && onDemandCount !== null) {
        setRiskSummary({ fixedRoute: fixedRouteCount, onDemand: onDemandCount });
      }
    });
    return () => {
      alive = false;
    };
  }, [canSeeServiceRisk]);

  return (
    <section className="service-operations-overview" aria-labelledby="service-operations-overview-title">
      <div className="service-operations-overview-head">
        <div>
          <span className="risk-eyebrow">Communications at a glance</span>
          <h3 id="service-operations-overview-title">Service Alert work</h3>
          <p>Choose the communication workflow that matches the task in front of you.</p>
        </div>
        <NavLink className="btn-primary" to="compose">Compose service alert</NavLink>
      </div>

      <div className="service-operations-card-grid">
        <ServiceOperationsCard
          title="Suggested Alerts"
          value={pendingCount === null ? "—" : pendingCount}
          detail={pendingCount === null ? "Review queue unavailable" : "Awaiting staff review"}
          to="suggested"
        />
        <ServiceOperationsCard
          title="Active Service Alerts"
          value={stats.activeCount === null ? "—" : stats.activeCount}
          detail="Currently eligible for rider display or delivery"
          to="active"
        />
        {canSeeServiceRisk ? (
          <ServiceOperationsCard
            title="Service Risk & Quality"
            value={riskSummary === null ? "—" : riskSummary.fixedRoute + riskSummary.onDemand}
            detail={riskSummary === null
              ? "Risk summary unavailable"
              : `${riskSummary.fixedRoute} fixed-route · ${riskSummary.onDemand} on-demand at risk`}
            to="risk"
          />
        ) : null}
      </div>

      <div className="service-operations-guidance">
        <strong>Human review remains required.</strong>
        <span>Detected service risk can prepare a Suggested Alert, but an authorized staff member must review and publish the resulting Service Alert.</span>
      </div>
    </section>
  );
}

function ServiceOperationsCard({
  title,
  value,
  detail,
  to,
}: {
  title: string;
  value: string | number;
  detail: string;
  to: string;
}) {
  return (
    <NavLink className="service-operations-card" to={to}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <span className="service-operations-card-link">Open workspace →</span>
    </NavLink>
  );
}
