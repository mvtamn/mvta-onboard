// The Escalation Streak's only arithmetic: three issued below-standard
// months in a row make the fourth one cost half again (Attachment G).
export function escalationMultiplier(consecutiveMonths: number): number {
  return consecutiveMonths >= 3 ? 1.5 : 1;
}

