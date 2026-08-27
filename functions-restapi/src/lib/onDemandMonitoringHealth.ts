export const ON_DEMAND_RECONCILIATION_INTERVAL_MINUTES = 60;
export const ON_DEMAND_DEGRADED_AFTER_MINUTES = 90;

export interface OnDemandMonitoringHealthSnapshot {
  lastAuthoritativeReconciliationAt: Date | null;
  latestSourceUpdateAt: Date | null;
  activeRequestCount: number | null;
}

export type OnDemandMonitoringState = "not_connected" | "current" | "no_active_service" | "degraded";

export function onDemandMonitoringState(
  enabled: boolean,
  health: OnDemandMonitoringHealthSnapshot | null,
  now = new Date(),
): OnDemandMonitoringState {
  if (!enabled) return "not_connected";
  if (!health?.lastAuthoritativeReconciliationAt) return "degraded";
  const ageMs = now.getTime() - health.lastAuthoritativeReconciliationAt.getTime();
  if (ageMs > ON_DEMAND_DEGRADED_AFTER_MINUTES * 60_000) return "degraded";
  return health.activeRequestCount === 0 ? "no_active_service" : "current";
}
