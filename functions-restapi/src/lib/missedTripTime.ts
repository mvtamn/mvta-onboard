const AGENCY_TIME_ZONE = "America/Chicago";
const SECONDS_PER_DAY = 24 * 60 * 60;

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInAgencyTime(date: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function offsetAt(date: Date): number {
  const local = partsInAgencyTime(date);
  const representedAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Converts an agency-local wall-clock value to a real UTC instant. The
// second offset pass is required because the first UTC guess can fall on the
// other side of a DST boundary from the final instant.
export function agencyLocalDateTimeToUtc(parts: DateParts): Date {
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = new Date(wallClockAsUtc - offsetAt(new Date(wallClockAsUtc)));
  candidate = new Date(wallClockAsUtc - offsetAt(candidate));
  return candidate;
}

export function serviceDateAndGtfsSecondsToUtc(serviceDate: string, gtfsSeconds: number): Date | null {
  if (!/^\d{8}$/.test(serviceDate) || !Number.isInteger(gtfsSeconds) || gtfsSeconds < 0) return null;
  const year = Number(serviceDate.slice(0, 4));
  const month = Number(serviceDate.slice(4, 6));
  const day = Number(serviceDate.slice(6, 8));
  const dayOffset = Math.floor(gtfsSeconds / SECONDS_PER_DAY);
  const secondsInDay = gtfsSeconds % SECONDS_PER_DAY;
  const shiftedDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return agencyLocalDateTimeToUtc({
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
    hour: Math.floor(secondsInDay / 3600),
    minute: Math.floor((secondsInDay % 3600) / 60),
    second: secondsInDay % 60,
  });
}

export function calendarDateAndTimeToUtc(calendarDate: string, time: string | null): Date | null {
  if (!time) return null;
  const dateMatch = calendarDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (hour > 47 || minute > 59 || second > 59) return null;
  const serviceDate = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`;
  return serviceDateAndGtfsSecondsToUtc(serviceDate, hour * 3600 + minute * 60 + second);
}

export function agencyServiceDate(now: Date, dayOffset = 0): { serviceDate: string; dow: string } {
  const local = partsInAgencyTime(now);
  const dateOnly = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  const serviceDate =
    `${dateOnly.getUTCFullYear()}` +
    `${String(dateOnly.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(dateOnly.getUTCDate()).padStart(2, "0")}`;
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return { serviceDate, dow: days[dateOnly.getUTCDay()] };
}

export const MISSED_TRIP_AGENCY_TIME_ZONE = AGENCY_TIME_ZONE;
