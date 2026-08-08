function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addBusinessDays(start: Date, count: number, holidays: ReadonlySet<string>): Date {
  if (!Number.isInteger(count) || count < 0) throw new Error("Business-day count must be a non-negative integer.");
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  let remaining = count;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(dateOnly(cursor))) remaining -= 1;
  }
  return cursor;
}

export function assertHolidayCoverage(
  start: Date,
  maximumCalendarDate: Date,
  coverageThrough: Date | null,
): void {
  if (!coverageThrough || coverageThrough < maximumCalendarDate || coverageThrough < start) {
    throw new Error("MVTA holiday calendar does not cover the complete deadline horizon.");
  }
}
