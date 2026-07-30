// Avail360 AVL Reports - Avail's own proprietary vehicle-location API
// (https://avail360-api.myavail.cloud/AVLReports/v1/{Property}/{date}),
// distinct from the GTFS-Realtime feeds already ingested elsewhere in this
// repo (gtfsRealtime.ts, gtfsTripUpdates.ts, gtfsVehiclePositions.ts). Keyed
// by Avail's own numeric Vehicle/Block/Run/Trip IDs - no guaranteed join to
// a GTFS trip_id, so this is handled as a fully separate data source.
export interface AvailAvlReport {
  Vehicle: number;
  Timestamp: string;
  Route: number | null;
  Block: number | null;
  Run: number | null;
  Trip: number | null;
  Latitude: number;
  Longitude: number;
  Heading: number | null;
  Direction: string | null;
}

export interface AvailAvlEnvelope {
  errors: string[];
  result: {
    "AVL Reports": AvailAvlReport[];
    RefreshTime: string;
    Property: string;
    StartDate: string;
    EndDate: string;
  };
  success: boolean;
}

function formatDateYyyyMmDd(date: Date): string {
  // UTC-based, same known simplification already used elsewhere in this repo
  // (e.g. gtfsMissedTripsPoll.ts's serviceDateToday()) - MVTA operates in a
  // single time zone and this only needs day-level granularity.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// baseUrl is the agency-level URL with no trailing date segment, e.g.
// "https://avail360-api.myavail.cloud/AVLReports/v1/MVTA" - the date is
// appended fresh on every poll since the API is date-scoped in its path.
export async function fetchAvlReports(
  baseUrl: string,
  apiKey: string,
  date: Date = new Date(),
): Promise<AvailAvlReport[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/${formatDateYyyyMmDd(date)}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail AVL Reports request failed: ${res.status}`);
  }
  const payload = (await res.json()) as AvailAvlEnvelope;
  if (!payload.success) {
    throw new Error(
      `Avail AVL Reports API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`,
    );
  }
  return payload.result?.["AVL Reports"] ?? [];
}

export interface MappedAvlVehicle {
  vehicle_id: number;
  route: number | null;
  block: number | null;
  run: number | null;
  trip: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  direction: string | null;
  report_timestamp: Date;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapVehiclePositionEntity/mapAlertEntity
// elsewhere in this repo).
export function mapAvlReport(report: AvailAvlReport): MappedAvlVehicle | null {
  if (
    typeof report.Vehicle !== "number" ||
    typeof report.Latitude !== "number" ||
    typeof report.Longitude !== "number"
  ) {
    return null;
  }
  const timestamp = new Date(report.Timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    vehicle_id: report.Vehicle,
    route: report.Route ?? null,
    block: report.Block ?? null,
    run: report.Run ?? null,
    trip: report.Trip ?? null,
    latitude: report.Latitude,
    longitude: report.Longitude,
    heading: report.Heading ?? null,
    direction: report.Direction ?? null,
    report_timestamp: timestamp,
  };
}
