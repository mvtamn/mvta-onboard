// On-Demand monitoring currency, read from the one ledger that records it.
//
// Each hourly reconciliation used to write the same fact twice: once to
// OnDemandMonitoringHealth (read by /on-demand-risks and the five-minute
// intervention evaluator) and once to the spare_on_demand_reconciliation row in
// KpiFeedHealth (read by KPI trust, the Admin trust view and Suggested Alert
// preparation). The two writes were not atomic, the states were named
// differently, and they agreed on the 90-minute boundary only because they
// imported one constant. A reconciliation whose later steps failed could leave
// the console saying "current" while the Admin page aged the same stream to
// Stale, and the evaluator checked both ledgers one after the other.
//
// ADR 0027 already says On-Demand currency is the hourly reconciliation on the
// 90-minute degraded boundary, which is exactly the KPI trust `on_demand`
// stream. So the monitoring state is now a projection of that stream, and the
// Degraded feed operators see is that stream not being Current:
//
//   monitoring disabled              -> not_connected
//   on_demand current                -> current
//   on_demand current_but_empty      -> no_active_service
//   on_demand stale or unavailable   -> degraded
//
// Kept in its own module: kpiTrust imports feedFreshness, which imports the
// degraded-boundary constant from onDemandMonitoringHealth, so resolving trust
// from inside that module would be an import cycle.
import { resolveKpiTrust, type KpiFeedHealth } from "./kpiTrust";
import type { OnDemandMonitoringState } from "./onDemandMonitoringHealth";

export interface OnDemandMonitoringStatus {
  state: OnDemandMonitoringState;
  // The start of the last complete authoritative read: what the risk queries
  // treat as the moment the monitor was last known to be whole.
  lastAuthoritativeReconciliationAt: Date | null;
  activeRequestCount: number | null;
}

export function onDemandMonitoringStatus(
  enabled: boolean,
  records: readonly KpiFeedHealth[],
  now = new Date(),
): OnDemandMonitoringStatus {
  const reconciliation = records.find((record) => record.feed_name === "spare_on_demand_reconciliation");
  const lastAuthoritativeReconciliationAt = reconciliation?.last_success_at
    ? reconciliation.coverage_end_at ?? reconciliation.last_success_at
    : null;
  const activeRequestCount = reconciliation?.last_success_at ? reconciliation.last_entity_count : null;
  if (!enabled) return { state: "not_connected", lastAuthoritativeReconciliationAt, activeRequestCount };

  const trust = resolveKpiTrust(records, now).on_demand.state;
  const state: OnDemandMonitoringState =
    trust === "current" ? "current"
      : trust === "current_but_empty" ? "no_active_service"
        : "degraded";
  return { state, lastAuthoritativeReconciliationAt, activeRequestCount };
}
