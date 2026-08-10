export function isTransientNotificationFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 30 * 2 ** Math.max(0, attempt - 1));
}

export function notificationHasExpired(createdAt: Date | string, now = new Date()): boolean {
  return now.getTime() - new Date(createdAt).getTime() >= 24 * 60 * 60 * 1000;
}
