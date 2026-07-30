// Avail360 Pullout Reports - a second, distinct Avail proprietary API from
// AVL Reports (availAvl.ts): dispatch-side check-in/login/pullout timing per
// block/run, both scheduled and actual, with Avail's own PulloutStatus
// classification (e.g. "Late Relief", "Expired Pullout"). More authoritative
// for garage-side lateness than anything inferred from GTFS or AVL data.
// The envelope shape is genuinely different from AVL Reports' - result.Pullout
// (not result["AVL Reports"]), with RefreshTime/Property nested in a
// result.results array rather than as sibling fields.
export interface AvailPulloutReport {
  Block: number;
  Run: number;
  Checkin_Scheduled: string | null;
  Checkin_Actual: string | null;
  Login_Scheduled: string | null;
  Login_Actual: string | null;
  Pullout_Scheduled: string | null;
  Pullout_Actual: string | null;
  PulloutStatus: string | null;
  OperatorName: string | null;
  LogonID: number | null;
  VehicleLabel: string | null;
}

export interface AvailPulloutEnvelope {
  errors: string[];
  result: {
    Pullout: AvailPulloutReport[];
    results: { RefreshTime: string; Property: string }[];
  };
  success: boolean;
}

function formatDateYyyyMmDd(date: Date): string {
  // UTC-based, same known simplification already used by availAvl.ts and
  // gtfsMissedTripsPoll.ts - MVTA operates in a single time zone and this
  // only needs day-level granularity.
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// baseUrl is the agency-level URL with no trailing date segment, e.g.
// "https://avail360-api.myavail.cloud/Pullout/v1/MVTA" - same date-suffixed
// convention as fetchAvlReports.
export async function fetchPulloutReports(
  baseUrl: string,
  apiKey: string,
  date: Date = new Date(),
): Promise<AvailPulloutReport[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/${formatDateYyyyMmDd(date)}`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail Pullout Reports request failed: ${res.status}`);
  }
  const payload = (await res.json()) as AvailPulloutEnvelope;
  if (!payload.success) {
    throw new Error(
      `Avail Pullout Reports API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`,
    );
  }
  return payload.result?.Pullout ?? [];
}

export interface MappedPullout {
  block: number;
  run: number;
  checkin_scheduled: Date | null;
  checkin_actual: Date | null;
  login_scheduled: Date | null;
  login_actual: Date | null;
  pullout_scheduled: Date | null;
  pullout_actual: Date | null;
  pullout_status: string | null;
  operator_name: string | null;
  logon_id: number | null;
  vehicle_label: string | null;
}

function parseNullableDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapVehiclePositionEntity).
export function mapPulloutReport(report: AvailPulloutReport): MappedPullout | null {
  if (typeof report.Block !== "number" || typeof report.Run !== "number") {
    return null;
  }

  return {
    block: report.Block,
    run: report.Run,
    checkin_scheduled: parseNullableDate(report.Checkin_Scheduled),
    checkin_actual: parseNullableDate(report.Checkin_Actual),
    login_scheduled: parseNullableDate(report.Login_Scheduled),
    login_actual: parseNullableDate(report.Login_Actual),
    pullout_scheduled: parseNullableDate(report.Pullout_Scheduled),
    pullout_actual: parseNullableDate(report.Pullout_Actual),
    pullout_status: report.PulloutStatus ?? null,
    operator_name: report.OperatorName ?? null,
    logon_id: report.LogonID ?? null,
    vehicle_label: report.VehicleLabel ?? null,
  };
}
