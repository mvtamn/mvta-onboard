export const ON_DEMAND_RECONCILIATION_INTERVAL_MINUTES = 60;
export const ON_DEMAND_DEGRADED_AFTER_MINUTES = 90;

// The activation gate for the whole On-Demand path: the read contract and the
// reconciliation timer must agree on what "enabled" means.
export function onDemandMonitoringEnabled(): boolean {
  return process.env.ON_DEMAND_MONITORING_ENABLED?.trim().toLowerCase() === "true";
}

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

export function onDemandMonitoringServiceIds(): ReadonlySet<string> {
  return new Set((process.env.ON_DEMAND_MONITORING_SERVICE_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
}

export type OnDemandActivation =
  | { active: false; reason: "disabled" | "unscoped" }
  | { active: true; serviceIds: ReadonlySet<string> };

// Enabled but unscoped is a misconfiguration, not a wider monitor: an empty
// scope once meant "read every Spare service the API key can see", so the
// single parameter flip that turns monitoring on would also have reconciled
// services that are not MVTA Connect. The scope is required with the switch
// rather than warned about in prose, and ADR 0026 keeps it from defaulting to
// SPARE_MISSED_TRIP_SERVICE_IDS.
export function onDemandActivation(
  enabled: boolean = onDemandMonitoringEnabled(),
  serviceIds: ReadonlySet<string> = onDemandMonitoringServiceIds(),
): OnDemandActivation {
  if (!enabled) return { active: false, reason: "disabled" };
  if (serviceIds.size === 0) return { active: false, reason: "unscoped" };
  return { active: true, serviceIds };
}
