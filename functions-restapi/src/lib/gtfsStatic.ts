// Static GTFS schedule - used only to resolve stop IDs into real stop names.
// TripUpdate (the realtime feed) only carries opaque internal StopIds; the
// static schedule zip is the sole source of human-readable stop names, so
// delay alert text can say "near 5th St & Main Ave" instead of "near 56878".
import AdmZip from "adm-zip";

export interface GtfsStopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: number | null;
  stop_lon: number | null;
}

// Minimal RFC4180-ish line splitter for stops.txt - GTFS static files are a
// well-defined, small CSV format; a full CSV library is unwarranted for one
// file, but a naive String.split(",") would break on a quoted stop name that
// itself contains a comma (e.g. "Main St, Suite 100"), so this still needs
// to be quote-aware.
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

export async function fetchAndParseStops(url: string): Promise<GtfsStopRow[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GTFS static feed request failed: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("stops.txt");
  if (!entry) {
    throw new Error("GTFS static feed zip has no stops.txt entry");
  }
  const csv = entry.getData().toString("utf-8");
  return parseStopsCsv(csv);
}
