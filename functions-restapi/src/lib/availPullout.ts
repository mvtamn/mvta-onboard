// Avail360 Pullout Reports - a second, distinct Avail proprietary API from
// AVL Reports (availAvl.ts): dispatch-side check-in/login/pullout timing per
// block/run, both scheduled and actual, with Avail's own PulloutStatus
// classification (e.g. "Late Relief", "Expired Pullout"). More authoritative
// for garage-side lateness than anything inferred from GTFS or AVL data.
// The envelope shape is genuinely different from AVL Reports' - result.Pullout
// (not result["AVL Reports"]), with RefreshTime/Property nested in a
// result.results array rather than as sibling fields.
import { agencyServiceDate } from "./missedTripTime";

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

// The confirmed OpenAPI path is exactly /Pullout/v1/{Property}; unlike AVL
// Reports, Pullout does not accept a date segment.
export async function fetchPulloutReports(
  baseUrl: string,
  apiKey: string,
): Promise<AvailPulloutReport[]> {
  const url = baseUrl.replace(/\/+$/, "");
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
  service_date: string;
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

// The Pullout endpoint takes no date segment - it always reports the
// property's current service day - so the service date has to be derived, and
// it is part of the (service_date, block, run) key the poller MERGEs on.
// Deriving it from the poll clock in UTC broke that key: the UTC date rolls
// over at 6/7pm agency-local, mid-service, so an evening poll re-INSERTED runs
// already stored under the correct day and double-counted them. Anchor to the
// run's own garage times in agency-local time instead. Scheduled times are
// preferred over actuals (a run's service day is fixed by its schedule, not by
// when it happened to leave), and garage times sit in the early morning, far
// from local midnight, so every poll across the day derives the same date and
// the MERGE stays idempotent. The poll clock is only a last resort for a report
// carrying no usable timestamp at all.
export function pulloutServiceDate(
  report: Pick<
    MappedPullout,
    | "checkin_scheduled"
    | "checkin_actual"
    | "login_scheduled"
    | "login_actual"
    | "pullout_scheduled"
    | "pullout_actual"
  >,
  now: Date = new Date(),
): string {
  const anchor =
    report.pullout_scheduled ??
    report.login_scheduled ??
    report.checkin_scheduled ??
    report.pullout_actual ??
    report.login_actual ??
    report.checkin_actual ??
    now;
  return agencyServiceDate(anchor).serviceDate;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapVehiclePositionEntity).
export function mapPulloutReport(
  report: AvailPulloutReport,
  now: Date = new Date(),
): MappedPullout | null {
  if (typeof report.Block !== "number" || typeof report.Run !== "number") {
    return null;
  }

  const times = {
    checkin_scheduled: parseNullableDate(report.Checkin_Scheduled),
    checkin_actual: parseNullableDate(report.Checkin_Actual),
    login_scheduled: parseNullableDate(report.Login_Scheduled),
    login_actual: parseNullableDate(report.Login_Actual),
    pullout_scheduled: parseNullableDate(report.Pullout_Scheduled),
    pullout_actual: parseNullableDate(report.Pullout_Actual),
  };

  return {
    service_date: pulloutServiceDate(times, now),
    ...times,
    block: report.Block,
    run: report.Run,
    pullout_status: report.PulloutStatus ?? null,
    operator_name: report.OperatorName ?? null,
    logon_id: report.LogonID ?? null,
    vehicle_label: report.VehicleLabel ?? null,
  };
}
