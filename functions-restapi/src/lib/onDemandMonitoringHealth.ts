export const ON_DEMAND_RECONCILIATION_INTERVAL_MINUTES = 60;
export const ON_DEMAND_DEGRADED_AFTER_MINUTES = 90;

// The activation gate for the whole On-Demand path: the read contract and the
// reconciliation timer must agree on what "enabled" means.
export function onDemandMonitoringEnabled(): boolean {
  return process.env.ON_DEMAND_MONITORING_ENABLED?.trim().toLowerCase() === "true";
}

// What the console and the intervention evaluator call the monitor's state. It
// is resolved from the KPI trust on_demand stream by onDemandMonitoringStatus;
// see that module for the mapping.
export type OnDemandMonitoringState = "not_connected" | "current" | "no_active_service" | "degraded";

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

export type MonitorWriteDecision =
  | { admit: true }
  | { admit: false; reason: "disabled" | "unscoped" | "out_of_scope" };

// Whether one source record may be written into on-demand monitor state.
//
// Scoping the hourly reconciliation was never enough to give a scoped table.
// Two other writers reach the same rows and neither consulted the activation:
// onDemandSpareWebhook wrote every requestStatus and ETA delivery Spare sent,
// and the monitor write that rides along on spareMissedTripsIngest is scoped
// to SPARE_MISSED_TRIP_SERVICE_IDS - three services, not all of them MVTA
// Connect - and runs whether on-demand monitoring is on or off. So
// MonitoredOnDemandWaits has been accumulating requests from services the
// monitor is not for, and would have kept them on the day it was switched on:
// the scoped reconciliation does not touch a foreign row, so it cannot correct
// one either.
//
// The same three-way answer as onDemandActivation, with the record's service
// added, so every writer asks one question and gets one contract. A record
// with no service id is never admitted: an unattributable request cannot be
// shown to belong to MVTA Connect, and guessing in the permissive direction is
// how the table got mixed in the first place.
export function admitsMonitorWrite(
  serviceId: string | null,
  activation: OnDemandActivation = onDemandActivation(),
): MonitorWriteDecision {
  if (!activation.active) return { admit: false, reason: activation.reason };
  if (!serviceId || !activation.serviceIds.has(serviceId)) {
    return { admit: false, reason: "out_of_scope" };
  }
  return { admit: true };
}
