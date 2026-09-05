// Static GTFS schedule - resolves two things GTFS-Realtime never provides on
// its own: real stop names (TripUpdate only carries opaque internal StopIds,
// so alert text can say "near 5th St & Main Ave" instead of "near 56878"),
// and trip direction (neither realtime feed has a direction field at all -
// confirmed by fetching and fully enumerating every field in both live
// feeds). Direction has to come from trips.txt's trip_headsign +
// direction_id, joined by trip_id.
//
// Both stops.txt and trips.txt are parsed from a single zip download - the
// static schedule doesn't change intraday, so there's no reason to fetch it
// twice in the same sync run.
import AdmZip from "adm-zip";

export interface GtfsStopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number | null;
  stop_lon: number | null;
}

export interface GtfsTripRow {
  trip_id: string;
  route_id: string;
  service_id: string;
  direction_id: number;
  trip_headsign: string | null;
  block_id?: string | null;
}

export interface GtfsRouteRow {
  route_id: string;
  agency_id: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
  route_desc: string | null;
  route_type: number;
  route_url: string | null;
  route_color: string | null;
  route_text_color: string | null;
  route_sort_order: number | null;
}

// Minimal RFC4180-ish line splitter - GTFS static files are a well-defined,
// small CSV format; a full CSV library is unwarranted for two files, but a
// naive String.split(",") would break on a quoted value that itself
// contains a comma (e.g. a stop name "Main St, Suite 100"), so this still
// needs to be quote-aware.
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

export function parseStopsCsv(csv: string): GtfsStopRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idIdx = header.indexOf("stop_id");
  const nameIdx = header.indexOf("stop_name");
  const latIdx = header.indexOf("stop_lat");
  const lonIdx = header.indexOf("stop_lon");
  if (idIdx === -1 || nameIdx === -1) {
    throw new Error("stops.txt is missing required stop_id/stop_name columns");
  }

  const rows: GtfsStopRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const stop_id = cols[idIdx]?.trim();
    const stop_name = cols[nameIdx]?.trim();
    if (!stop_id || !stop_name) continue;
    const lat = latIdx !== -1 ? parseFloat(cols[latIdx]) : NaN;
    const lon = lonIdx !== -1 ? parseFloat(cols[lonIdx]) : NaN;
    rows.push({
      stop_id,
      stop_name,
      stop_lat: Number.isFinite(lat) ? lat : null,
      stop_lon: Number.isFinite(lon) ? lon : null,
    });
  }
  return rows;
}

export function parseTripsCsv(csv: string): GtfsTripRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idIdx = header.indexOf("trip_id");
  const routeIdx = header.indexOf("route_id");
  const serviceIdx = header.indexOf("service_id");
  const dirIdx = header.indexOf("direction_id");
  const headsignIdx = header.indexOf("trip_headsign");
  const blockIdx = header.indexOf("block_id");
  if (idIdx === -1 || routeIdx === -1 || dirIdx === -1) {
    throw new Error("trips.txt is missing required trip_id/route_id/direction_id columns");
  }

  const rows: GtfsTripRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const trip_id = cols[idIdx]?.trim();
    const route_id = cols[routeIdx]?.trim();
    const service_id = serviceIdx !== -1 ? cols[serviceIdx]?.trim() : "";
    const direction_id = parseInt(cols[dirIdx]?.trim(), 10);
    if (!trip_id || !route_id || !Number.isFinite(direction_id)) continue;
    const headsign = headsignIdx !== -1 ? cols[headsignIdx]?.trim() : "";
    rows.push({
      trip_id,
      route_id,
      service_id: service_id || "",
      direction_id,
      trip_headsign: headsign || null,
      block_id: blockIdx !== -1 ? cols[blockIdx]?.trim() || null : null,
    });
  }
  return rows;
}

// GTFS times can exceed 24:00:00 for a trip that starts before midnight and
// runs past it (e.g. "25:10:00") - that's by design, not an error, so this
// parses the raw H:MM:SS components directly rather than going through a
// Date/TIME type that would reject or wrap an out-of-range hour.
function parseGtfsTimeToSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export interface GtfsScheduledTripRow {
  trip_id: string;
  first_departure_seconds: number;
  first_stop_id: string | null;
  first_stop_sequence: number;
}

// Only the earliest stop_sequence's departure_time per trip is needed (the
// scheduled start time) - not every intermediate stop, so this reduces
// stop_times.txt (often the largest file in a GTFS feed) down to one row per
// trip_id as it scans, rather than materializing every row.
export function parseStopTimesCsv(csv: string): GtfsScheduledTripRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const tripIdx = header.indexOf("trip_id");
  const seqIdx = header.indexOf("stop_sequence");
  const depIdx = header.indexOf("departure_time");
  const stopIdx = header.indexOf("stop_id");
  if (tripIdx === -1 || seqIdx === -1 || depIdx === -1 || stopIdx === -1) {
    throw new Error("stop_times.txt is missing required trip_id/stop_sequence/departure_time/stop_id columns");
  }

  const earliest = new Map<string, { sequence: number; seconds: number; stopId: string | null }>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const trip_id = cols[tripIdx]?.trim();
    const sequence = parseInt(cols[seqIdx]?.trim(), 10);
    const seconds = depIdx !== -1 ? parseGtfsTimeToSeconds(cols[depIdx] ?? "") : null;
    if (!trip_id || !Number.isFinite(sequence) || seconds === null) continue;
    const current = earliest.get(trip_id);
    if (!current || sequence < current.sequence) {
      earliest.set(trip_id, { sequence, seconds, stopId: cols[stopIdx]?.trim() || null });
    }
  }

  return Array.from(earliest.entries()).map(([trip_id, v]) => ({
    trip_id,
    first_departure_seconds: v.seconds,
    first_stop_id: v.stopId,
    first_stop_sequence: v.sequence,
  }));
}

// Distinct (stop_id, route_id) pairs: every stop each route serves, from
// stop_times.txt joined to trips.txt. Second pass over stop_times, kept
// separate from parseStopTimesCsv so that function's one-row-per-trip
// reduction stays simple. Memory is bounded by the number of distinct
// pairs, not rows.
export interface GtfsStopRouteRow { stop_id: string; route_id: string; }

export function parseStopRouteLinksCsv(csv: string, trips: Pick<GtfsTripRow, "trip_id" | "route_id">[]): GtfsStopRouteRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const tripIdx = header.indexOf("trip_id");
  const stopIdx = header.indexOf("stop_id");
  if (tripIdx === -1 || stopIdx === -1) throw new Error("stop_times.txt is missing required trip_id/stop_id columns");
  const routeByTrip = new Map(trips.map((t) => [t.trip_id, t.route_id]));
  const seen = new Set<string>();
  const rows: GtfsStopRouteRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const trip_id = cols[tripIdx]?.trim();
    const stop_id = cols[stopIdx]?.trim();
    const route_id = trip_id ? routeByTrip.get(trip_id) : undefined;
    if (!stop_id || !route_id) continue;
    const key = `${stop_id}\u0000${route_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ stop_id, route_id });
  }
  return rows;
}

export interface GtfsCalendarRow {
  service_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_date: string;
  end_date: string;
}

export function parseCalendarCsv(csv: string): GtfsCalendarRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idIdx = header.indexOf("service_id");
  const dayIdx: Record<string, number> = {
    monday: header.indexOf("monday"),
    tuesday: header.indexOf("tuesday"),
    wednesday: header.indexOf("wednesday"),
    thursday: header.indexOf("thursday"),
    friday: header.indexOf("friday"),
    saturday: header.indexOf("saturday"),
    sunday: header.indexOf("sunday"),
  };
  const startIdx = header.indexOf("start_date");
  const endIdx = header.indexOf("end_date");
  if (idIdx === -1 || startIdx === -1 || endIdx === -1 || Object.values(dayIdx).some((i) => i === -1)) {
    throw new Error("calendar.txt is missing required service_id/day/start_date/end_date columns");
  }

  const rows: GtfsCalendarRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const service_id = cols[idIdx]?.trim();
    const start_date = cols[startIdx]?.trim();
    const end_date = cols[endIdx]?.trim();
    if (!service_id || !start_date || !end_date) continue;
    rows.push({
      service_id,
      monday: cols[dayIdx.monday]?.trim() === "1",
      tuesday: cols[dayIdx.tuesday]?.trim() === "1",
      wednesday: cols[dayIdx.wednesday]?.trim() === "1",
      thursday: cols[dayIdx.thursday]?.trim() === "1",
      friday: cols[dayIdx.friday]?.trim() === "1",
      saturday: cols[dayIdx.saturday]?.trim() === "1",
      sunday: cols[dayIdx.sunday]?.trim() === "1",
      start_date,
      end_date,
    });
  }
  return rows;
}

export interface GtfsCalendarDateRow {
  service_id: string;
  service_date: string;
  exception_type: 1 | 2;
}

export function parseCalendarDatesCsv(csv: string): GtfsCalendarDateRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idIdx = header.indexOf("service_id");
  const dateIdx = header.indexOf("date");
  const exceptionIdx = header.indexOf("exception_type");
  if (idIdx === -1 || dateIdx === -1 || exceptionIdx === -1) {
    throw new Error("calendar_dates.txt is missing required service_id/date/exception_type columns");
  }

  const rows: GtfsCalendarDateRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const service_id = cols[idIdx]?.trim();
    const service_date = cols[dateIdx]?.trim();
    const exception_type = parseInt(cols[exceptionIdx]?.trim(), 10);
    if (!service_id || !service_date || (exception_type !== 1 && exception_type !== 2)) continue;
    rows.push({ service_id, service_date, exception_type });
  }
  return rows;
}

export function parseRoutesCsv(csv: string): GtfsRouteRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  const indexOf = (name: string) => header.indexOf(name);
  const idIdx = indexOf("route_id");
  const agencyIdx = indexOf("agency_id");
  const shortIdx = indexOf("route_short_name");
  const longIdx = indexOf("route_long_name");
  const descIdx = indexOf("route_desc");
  const typeIdx = indexOf("route_type");
  const urlIdx = indexOf("route_url");
  const colorIdx = indexOf("route_color");
  const textColorIdx = indexOf("route_text_color");
  const sortIdx = indexOf("route_sort_order");

  if (idIdx === -1 || shortIdx === -1 || longIdx === -1 || typeIdx === -1) {
    throw new Error(
      "routes.txt is missing required route_id/route name/route_type columns",
    );
  }

  const optional = (cols: string[], index: number): string | null => {
    if (index === -1) return null;
    return cols[index]?.trim() || null;
  };

  const rows: GtfsRouteRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const route_id = cols[idIdx]?.trim();
    const route_short_name = optional(cols, shortIdx);
    const route_long_name = optional(cols, longIdx);
    const route_type = Number.parseInt(cols[typeIdx]?.trim(), 10);
    if (
      !route_id ||
      (!route_short_name && !route_long_name) ||
      !Number.isFinite(route_type)
    ) {
      continue;
    }
    const sortOrderRaw = optional(cols, sortIdx);
    const sortOrder = sortOrderRaw === null ? NaN : Number.parseInt(sortOrderRaw, 10);
    rows.push({
      route_id,
      agency_id: optional(cols, agencyIdx),
      route_short_name,
      route_long_name,
      route_desc: optional(cols, descIdx),
      route_type,
      route_url: optional(cols, urlIdx),
      route_color: optional(cols, colorIdx),
      route_text_color: optional(cols, textColorIdx),
      route_sort_order: Number.isFinite(sortOrder) ? sortOrder : null,
    });
  }
  return rows;
}

const DIRECTION_WORD_TO_LABEL: Record<string, string> = {
  North: "NB",
  South: "SB",
  East: "EB",
  West: "WB",
};

// Confirmed against a live sample: 98.1% of headsigns contain an explicit
// cardinal word somewhere in the string (not always the first word - some
// have a route-branding prefix, e.g. "4FUN East to MOA/MSP"), so this
// searches the whole string rather than just splitting on the first word.
// Returns null for the ~2% with no cardinal word at all - the sync job that
// calls this is responsible for falling back to another trip on the same
// route_id+direction_id in that case, not this pure function.
export function deriveDirectionLabel(headsign: string | null): string | null {
  if (!headsign) return null;
  const match = headsign.match(/\b(North|South|East|West)\b/);
  return match ? DIRECTION_WORD_TO_LABEL[match[1]] : null;
}

export interface ResolvedTripDirection extends GtfsTripRow {
  direction_label: string | null;
}

// ~98% of headsigns contain an explicit cardinal word; the rest (confirmed
// today: all of route 436/direction 0) fall back to another trip sharing
// the same route_id+direction_id that does have one. Some route+direction
// combos may have no determinable label at all - direction_label stays
// null in that case rather than guessing.
export function resolveDirectionLabels(trips: GtfsTripRow[]): ResolvedTripDirection[] {
  const ownLabel = new Map<string, string | null>();
  const fallbackByRouteDirection = new Map<string, string>();

  for (const trip of trips) {
    const label = deriveDirectionLabel(trip.trip_headsign);
    ownLabel.set(trip.trip_id, label);
    const key = `${trip.route_id}|${trip.direction_id}`;
    if (label && !fallbackByRouteDirection.has(key)) {
      fallbackByRouteDirection.set(key, label);
    }
  }

  return trips.map((trip) => {
    const key = `${trip.route_id}|${trip.direction_id}`;
    return {
      ...trip,
      direction_label: ownLabel.get(trip.trip_id) ?? fallbackByRouteDirection.get(key) ?? null,
    };
  });
}

export interface GtfsStaticData {
  stops: GtfsStopRow[];
  trips: GtfsTripRow[];
  routes: GtfsRouteRow[];
  scheduledTrips: GtfsScheduledTripRow[];
  stopRoutes: GtfsStopRouteRow[];
  calendar: GtfsCalendarRow[];
  calendarDates: GtfsCalendarDateRow[];
}

export async function fetchAndParseStatic(url: string): Promise<GtfsStaticData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GTFS static feed request failed: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);

  const stopsEntry = zip.getEntry("stops.txt");
  if (!stopsEntry) {
    throw new Error("GTFS static feed zip has no stops.txt entry");
  }
  const tripsEntry = zip.getEntry("trips.txt");
  if (!tripsEntry) {
    throw new Error("GTFS static feed zip has no trips.txt entry");
  }
  const routesEntry = zip.getEntry("routes.txt");
  if (!routesEntry) {
    throw new Error("GTFS static feed zip has no routes.txt entry");
  }
  const stopTimesEntry = zip.getEntry("stop_times.txt");
  if (!stopTimesEntry) {
    throw new Error("GTFS static feed zip has no stop_times.txt entry");
  }

  // calendar.txt and calendar_dates.txt are each individually optional per
  // the GTFS spec (a producer may express service days with only one of the
  // two) - so a missing file here just means "no rows from this source",
  // not a malformed feed.
  const calendarEntry = zip.getEntry("calendar.txt");
  const calendarDatesEntry = zip.getEntry("calendar_dates.txt");

  const tripsCsv = tripsEntry.getData().toString("utf-8");
  const stopTimesCsv = stopTimesEntry.getData().toString("utf-8");
  const trips = parseTripsCsv(tripsCsv);
  return {
    stops: parseStopsCsv(stopsEntry.getData().toString("utf-8")),
    trips,
    routes: parseRoutesCsv(routesEntry.getData().toString("utf-8")),
    scheduledTrips: parseStopTimesCsv(stopTimesCsv),
    stopRoutes: parseStopRouteLinksCsv(stopTimesCsv, trips),
    calendar: calendarEntry ? parseCalendarCsv(calendarEntry.getData().toString("utf-8")) : [],
    calendarDates: calendarDatesEntry
      ? parseCalendarDatesCsv(calendarDatesEntry.getData().toString("utf-8"))
      : [],
  };
}
