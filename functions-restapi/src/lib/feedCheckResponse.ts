export type FeedResponseSummary = { records: number; keys?: string[] };

export function summarizeFeedResponse(body: unknown): FeedResponseSummary {
  if (!body || typeof body !== "object") return { records: 0 };
  const value = body as Record<string, unknown>;
  if (Array.isArray(value.Entities)) return { records: value.Entities.length };
  if (Array.isArray(value.data)) {
    const total = typeof value.total === "number" && Number.isInteger(value.total) && value.total >= 0
      ? value.total
      : value.data.length;
    const first = value.data[0];
    return { records: total, keys: first && typeof first === "object" ? Object.keys(first) : undefined };
  }
  const result = value.result && typeof value.result === "object" ? value.result as Record<string, unknown> : {};
  const array = Object.values(result).find(Array.isArray);
  return { records: Array.isArray(array) ? array.length : 0, keys: Object.keys(result) };
}
