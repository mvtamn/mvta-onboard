// The list-valued Messages columns (channels, tags, routes_affected,
// stops_affected, zones_affected) are NVARCHAR and every current writer
// stores a JSON array. Rows that predate that convention hold a plain
// comma-separated string ("web,sms"), and JSON.parse on one of those took
// the whole read down: GET /manage/messages answered 500 on dev the first
// day the route was reachable. Read them leniently - JSON when it is JSON,
// split on commas when it is not, never throw - so one legacy row cannot
// blank an entire list.
export function parseStringList(value: string | null | undefined): string[] {
  if (value == null) return [];
  const text = value.trim();
  if (text === "") return [];

  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map((item) => String(item).trim())
          .filter((item) => item !== "");
      }
    } catch {
      // Not valid JSON after all - fall through to the delimited form.
    }
  }

  return text
    .split(",")
    .map((item) => item.trim().replace(/^"(.*)"$/, "$1"))
    .filter((item) => item !== "");
}
