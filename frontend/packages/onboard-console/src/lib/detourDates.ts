// Date handling for the detour module.
//
// GET /detours now normalizes start_date/end_date to plain YYYY-MM-DD
// (detoursList.ts), but these helpers stay defensive about full ISO
// timestamps anyway: the underlying columns are SQL DATE, the mssql driver
// returns them as JS Date objects, and anything that forgets to normalize
// hands this console an ISO timestamp. That mismatch is what previously
// made the console render raw "2026-08-08T00:00:00.000Z" in date columns,
// blank out the edit form's date inputs (which silently reject a value that
// isn't exactly YYYY-MM-DD - so saving an edit would have WIPED the dates),
// and mis-filter every date range. Parse defensively, render deliberately.
export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

// For <input type="date">, which accepts YYYY-MM-DD and nothing else.
export function toDateInputValue(value: string | null | undefined): string {
  return toDateOnly(value) ?? "";
}

// A detour date is a service day, not an instant - so it's built at UTC
// midnight and read back in UTC. Constructing it in local time would shift
// it a day backwards for anyone west of Greenwich, which is everyone here.
export function dateLabel(value: string | null | undefined): string {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) return "Open-ended";
  const d = new Date(`${dateOnly}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? dateOnly
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// reported_at/approved_at are DATETIME2 - real instants, so unlike the
// service-day dates above these are rendered in the viewer's local zone.
export function dateTimeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}
