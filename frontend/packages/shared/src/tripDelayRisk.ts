import type { TripDelay } from "./types.js";

export const DEPARTURE_RISK_THRESHOLD_SECONDS = 15 * 60;
export const DEPARTURE_WATCH_THRESHOLD_SECONDS = 10 * 60;

type TripDelayRiskInput = Pick<
  TripDelay,
  "predicted_max_departure_delay_seconds" | "delay_seconds"
>;

export function departureRiskSeconds(delay: TripDelayRiskInput): number {
  return delay.predicted_max_departure_delay_seconds ?? delay.delay_seconds;
}

export function isDepartureAtRisk(delay: TripDelayRiskInput): boolean {
  return departureRiskSeconds(delay) > DEPARTURE_RISK_THRESHOLD_SECONDS;
}

export function isDepartureWatch(delay: TripDelayRiskInput): boolean {
  const seconds = departureRiskSeconds(delay);
  return seconds >= DEPARTURE_WATCH_THRESHOLD_SECONDS && seconds <= DEPARTURE_RISK_THRESHOLD_SECONDS;
}
