// Reading a day's capture file back (capture.ts writes it): one record per
// line, in the order the runs wrote them. Each run's R line comes first and
// its P, B and V lines follow it, so a reader that needs to know which run a
// prediction came from takes the last R line before it.
//
// Pure: lines in, records out. A line that does not parse is counted, not
// thrown, so one torn write does not lose the night's score.

export type VehicleStatus = "incoming" | "stopped" | "in_transit";

export interface RunRecord {
  kind: "R";
  runAt: number;
  /** TripUpdates header timestamp; null on a :30 run, which does not read them. */
  tripUpdatesAt: number | null;
  vehiclesAt: number | null;
}

export interface StopTimeRecord {
  /** P: predicted at or after sampling. B: a stop time before sampling. */
  kind: "P" | "B";
  sampledAt: number;
  tripId: string;
  routeId: string;
  startDate: string;
  stopSequence: number | null;
  stopId: string;
  /** The stop time the feed gave (arrival, else departure). */
  at: number;
  vehicleId: string | null;
}

export interface VehicleRecord {
  kind: "V";
  feedAt: number;
  /** The vehicle's own timestamp; null when the feed gave none. */
  vehicleAt: number | null;
  vehicleId: string;
  tripId: string | null;
  routeId: string | null;
  stopSequence: number | null;
  stopId: string | null;
  status: VehicleStatus;
}

export type CaptureRecord = RunRecord | StopTimeRecord | VehicleRecord;

/** CSV fields, honouring the quoting capture.ts applies. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; continue; }
        if (line[i] === '"') { i++; break; }
        value += line[i++];
      }
      out.push(value);
      i++; // the comma
    } else {
      const end = line.indexOf(",", i);
      out.push(end === -1 ? line.slice(i) : line.slice(i, end));
      i = end === -1 ? line.length + 1 : end + 1;
    }
  }
  return out;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

/**
 * GTFS-RT VehicleStopStatus, as the debug JSON gives it (0, 1, 2) or by name.
 * Absent means IN_TRANSIT_TO, the spec's default.
 */
export function vehicleStatus(value: string | undefined): VehicleStatus {
  switch (value) {
    case "0": case "INCOMING_AT": return "incoming";
    case "1": case "STOPPED_AT": return "stopped";
    default: return "in_transit";
  }
}

export function parseCaptureLine(line: string): CaptureRecord | null {
  const f = splitCsvLine(line);
  switch (f[0]) {
    case "R": {
      const runAt = num(f[1]);
      return runAt === null ? null : { kind: "R", runAt, tripUpdatesAt: num(f[2]), vehiclesAt: num(f[3]) };
    }
    case "P":
    case "B": {
      const sampledAt = num(f[1]);
      const at = num(f[7]);
      const tripId = text(f[2]);
      const stopId = text(f[6]);
      if (sampledAt === null || at === null || !tripId || !stopId) return null;
      return {
        kind: f[0], sampledAt, tripId, routeId: f[3] ?? "", startDate: f[4] ?? "",
        stopSequence: num(f[5]), stopId, at, vehicleId: text(f[8]),
      };
    }
    case "V": {
      const feedAt = num(f[1]);
      const vehicleId = text(f[3]);
      if (feedAt === null || !vehicleId) return null;
      return {
        kind: "V", feedAt, vehicleAt: num(f[2]), vehicleId, tripId: text(f[4]), routeId: text(f[5]),
        stopSequence: num(f[7]), stopId: text(f[8]), status: vehicleStatus(f[9]),
      };
    }
    default:
      return null;
  }
}

export interface ParsedCapture {
  records: CaptureRecord[];
  /** Lines that did not parse: a torn write, or a format this reader does not know. */
  unreadable: number;
}

export function parseCapture(lines: Iterable<string>): ParsedCapture {
  const records: CaptureRecord[] = [];
  let unreadable = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const record = parseCaptureLine(line);
    if (record) records.push(record);
    else unreadable++;
  }
  return { records, unreadable };
}
