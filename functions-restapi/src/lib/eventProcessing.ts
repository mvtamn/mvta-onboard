export interface TimestampedObservation {
  report_timestamp: Date | string;
}

export function shouldAcceptObservation(
  current: TimestampedObservation | null | undefined,
  candidate: TimestampedObservation,
): boolean {
  if (!current) return true;
  return new Date(candidate.report_timestamp).getTime() >= new Date(current.report_timestamp).getTime();
}

export function detectionWindowSeconds(intervalSeconds: number): number {
  const safeInterval = Number.isFinite(intervalSeconds) ? Math.max(0, intervalSeconds) : 0;
  return Math.max(180, safeInterval * 2);
}

export function isStableTransition(
  previousSide: boolean | null,
  candidateSide: boolean,
  confirmations: number,
  requiredConfirmations = 2,
): boolean {
  if (previousSide === null || previousSide === candidateSide) return false;
  return confirmations + 1 >= requiredConfirmations;
}

export function nextTransitionConfirmations(
  previousSide: boolean | null,
  candidateSide: boolean,
  confirmations: number,
): number {
  if (previousSide === candidateSide) return 0;
  return confirmations + 1;
}
