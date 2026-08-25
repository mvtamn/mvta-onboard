import { timingSafeEqual } from "node:crypto";

export const SPARE_WEBHOOK_EVENT_TYPES = [
  "requestStatus",
  "eta",
  "vehicleLocation",
  "dutyMatchingStatus",
] as const;

export type SpareWebhookEventType = (typeof SPARE_WEBHOOK_EVENT_TYPES)[number];

export function hasSpareWebhookAuthorization(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const expected = `Bearer ${secret}`;
  const received = Buffer.from(header);
  const expectedBytes = Buffer.from(expected);
  return received.length === expectedBytes.length && timingSafeEqual(received, expectedBytes);
}

export function spareWebhookEventType(payload: unknown): SpareWebhookEventType | null {
  if (!payload || typeof payload !== "object") return null;
  const type = (payload as { type?: unknown }).type;
  return SPARE_WEBHOOK_EVENT_TYPES.includes(type as SpareWebhookEventType)
    ? type as SpareWebhookEventType
    : null;
}
