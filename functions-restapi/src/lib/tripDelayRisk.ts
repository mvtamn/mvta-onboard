export const DEPARTURE_RISK_THRESHOLD_SECONDS = 15 * 60;

export interface TripDelayRiskInput {
  delay_seconds: number;
  predicted_max_departure_delay_seconds: number | null;
}

export function departureRiskSeconds(delay: TripDelayRiskInput): number {
  return delay.predicted_max_departure_delay_seconds ?? delay.delay_seconds;
}

export function isDepartureAtRisk(delay: TripDelayRiskInput): boolean {
  return departureRiskSeconds(delay) > DEPARTURE_RISK_THRESHOLD_SECONDS;
}
