// What the zone geometry panel says about the feed Operational zones are
// pulled from (ADR 0031): whether it is configured, when it was last checked
// and how that went, and when the next check is due.
import type { KpiFeedHealth, KpiFeedName } from "./kpiTrust";

// The ledger row the daily pull records, and the one the panel reads back.
export const ZONE_FEED_NAME = "on_demand_zones" satisfies KpiFeedName;

// Daily at 09:30 UTC (04:30 CDT, 03:30 CST), before on-demand service starts.
// The timer's schedule is built from these, so the "next check" the panel shows
// is the one the timer actually runs.
export const ZONE_FEED_CHECK_UTC_HOUR = 9;
export const ZONE_FEED_CHECK_UTC_MINUTE = 30;
export const ON_DEMAND_ZONES_SYNC_SCHEDULE = `0 ${ZONE_FEED_CHECK_UTC_MINUTE} ${ZONE_FEED_CHECK_UTC_HOUR} * * *`;

export interface ZoneFeedStatus {
  configured: boolean;
  last_checked_at: string | null;
  last_check_succeeded: boolean | null;
  // Only when the most recent check failed; an older failure is history.
  last_failure_reason: string | null;
  next_check_at: string | null;
}

function nextCheck(now: Date): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ZONE_FEED_CHECK_UTC_HOUR, ZONE_FEED_CHECK_UTC_MINUTE));
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + 24 * 60 * 60_000);
}

export function zoneFeedStatus(input: { configured: boolean; health: KpiFeedHealth | undefined; now: Date }): ZoneFeedStatus {
  const success = input.health?.last_success_at ?? null;
  const failure = input.health?.last_failure_at ?? null;
  const failedLast = failure !== null && (success === null || failure.getTime() > success.getTime());
  const lastChecked = failedLast ? failure : success;
  return {
    configured: input.configured,
    last_checked_at: lastChecked?.toISOString() ?? null,
    last_check_succeeded: lastChecked ? !failedLast : null,
    last_failure_reason: failedLast ? input.health?.last_failure_reason ?? null : null,
    next_check_at: input.configured ? nextCheck(input.now).toISOString() : null,
  };
}
