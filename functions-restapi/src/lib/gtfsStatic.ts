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
  direction_id: number;
  trip_headsign: string | null;
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
function parseCsvLine(line: string): string[] {
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
  const dirIdx = header.indexOf("direction_id");
  const headsignIdx = header.indexOf("trip_headsign");
  if (idIdx === -1 || routeIdx === -1 || dirIdx === -1) {
    throw new Error("trips.txt is missing required trip_id/route_id/direction_id columns");
  }

  const rows: GtfsTripRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const trip_id = cols[idIdx]?.trim();
    const route_id = cols[routeIdx]?.trim();
    const direction_id = parseInt(cols[dirIdx]?.trim(), 10);
    if (!trip_id || !route_id || !Number.isFinite(direction_id)) continue;
    const headsign = headsignIdx !== -1 ? cols[headsignIdx]?.trim() : "";
    rows.push({
      trip_id,
      route_id,
      direction_id,
      trip_headsign: headsign || null,
    });
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

  return {
    stops: parseStopsCsv(stopsEntry.getData().toString("utf-8")),
    trips: parseTripsCsv(tripsEntry.getData().toString("utf-8")),
    routes: parseRoutesCsv(routesEntry.getData().toString("utf-8")),
  };
}
