export const DEFAULT_ON_DEMAND_SERVICE_STANDARD_MINUTES = 25;
export const MIN_ON_DEMAND_SERVICE_STANDARD_MINUTES = 10;
export const MAX_ON_DEMAND_SERVICE_STANDARD_MINUTES = 60;

export interface OnDemandServiceStandardOverride {
  zoneExternalLocationId: string;
  minutes: number;
  effectiveAt: string;
  expiresAt: string;
}

export interface OnDemandServiceStandardPolicy {
  defaultMinutes: number;
  overrides: readonly OnDemandServiceStandardOverride[];
}

export function applicableServiceStandard(
  policy: OnDemandServiceStandardPolicy,
  zoneExternalLocationId: string | null,
  now = new Date(),
): number {
  const nowMs = now.getTime();
  const override = policy.overrides.find((item) => item.zoneExternalLocationId === zoneExternalLocationId
    && Date.parse(item.effectiveAt) <= nowMs
    && nowMs < Date.parse(item.expiresAt));
  return override?.minutes ?? policy.defaultMinutes;
}
