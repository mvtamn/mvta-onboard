// OTP Compliance module data (mock, used as a graceful fallback when the
// real Avail feeds - see OTP-Feed-Evaluation-and-Recommendation.md - aren't
// configured/populated yet). Reason codes, exclusion decisions, and the
// detection threshold are now admin-editable/persisted via the DB (see
// otpReasonCodes.ts/otpStopExclusions.ts/otpDateExclusions.ts/otpSettings.ts)
// rather than hardcoded here - this file now holds only the mock preview
// data and the pure derivation functions shared between live and mock modes.
import type { OtpMonthlyStopRow, OtpMonthlyRouteRollup } from "@mvta/shared";

export interface RouteRow {
  route: string;
  total: number;
  ontime: number;
  pct_raw: number;
}

export interface Candidate {
  route: string;
  // Real numeric id + day-of-week for live rows, so a review decision can be
  // persisted/matched against OtpStopExclusions (service_month+route_id+
  // stop_id+day_of_week). null for the mock DATA.candidates below, which
  // exist for preview only and are never persisted.
  route_id: number | null;
  stopName: string;
  stopId: number;
  day_of_week: string | null;
  direction: string;
  n: number;
  early_pct: number;
  late_pct: number;
  ontime_pct: number;
  missed_pct: number;
  // The live Avail feed has no average-seconds-variance field - null for
  // rows derived from it (deriveCandidatesFromLive below); only the mock
  // DATA.candidates below carries a real value.
  avg_var: number | null;
}

export const DATA: { routes: RouteRow[]; candidates: Candidate[] } = {
  routes: [
    { route: "493", total: 102, ontime: 45, pct_raw: 44.1 },
    { route: "490", total: 508, ontime: 231, pct_raw: 45.5 },
    { route: "499", total: 582, ontime: 309, pct_raw: 53.1 },
    { route: "460", total: 615, ontime: 383, pct_raw: 62.3 },
    { route: "440", total: 690, ontime: 439, pct_raw: 63.6 },
    { route: "477", total: 783, ontime: 528, pct_raw: 67.4 },
    { route: "465", total: 974, ontime: 685, pct_raw: 70.3 },
    { route: "444", total: 2833, ontime: 2008, pct_raw: 70.9 },
    { route: "Orange LINK", total: 938, ontime: 685, pct_raw: 73.0 },
    { route: "495", total: 3262, ontime: 2393, pct_raw: 73.4 },
    { route: "420", total: 576, ontime: 455, pct_raw: 79.0 },
    { route: "480", total: 263, ontime: 208, pct_raw: 79.1 },
    { route: "470", total: 340, ontime: 269, pct_raw: 79.1 },
    { route: "475", total: 714, ontime: 569, pct_raw: 79.7 },
    { route: "447", total: 552, ontime: 443, pct_raw: 80.3 },
    { route: "497", total: 492, ontime: 401, pct_raw: 81.5 },
    { route: "436", total: 888, ontime: 752, pct_raw: 84.7 },
    { route: "442", total: 710, ontime: 627, pct_raw: 88.3 },
    { route: "445", total: 1104, ontime: 999, pct_raw: 90.5 },
    { route: "446", total: 1110, ontime: 1041, pct_raw: 93.8 },
  ],
  candidates: [
    { route: "490", route_id: null, stopName: "Wash/Coffman SW", stopId: 13209, day_of_week: null, direction: "North", n: 34, early_pct: 32.4, late_pct: 44.1, ontime_pct: 23.5, missed_pct: 0, avg_var: 164 },
    { route: "470", route_id: null, stopName: "Eagan TS", stopId: 30535, day_of_week: null, direction: "South", n: 34, early_pct: 20.6, late_pct: 35.3, ontime_pct: 44.1, missed_pct: 0, avg_var: 144.7 },
    { route: "490", route_id: null, stopName: "12 St/Hennep. S", stopId: 19332, day_of_week: null, direction: "North", n: 34, early_pct: 52.9, late_pct: 11.8, ontime_pct: 35.3, missed_pct: 0, avg_var: -132.2 },
    { route: "477", route_id: null, stopName: "2 Av S/10 St NE", stopId: 53307, day_of_week: null, direction: "North", n: 89, early_pct: 19.1, late_pct: 15.7, ontime_pct: 65.2, missed_pct: 0, avg_var: 85.2 },
    { route: "470", route_id: null, stopName: "2 Av S/10 St NE", stopId: 53307, day_of_week: null, direction: "North", n: 34, early_pct: 17.6, late_pct: 8.8, ontime_pct: 73.5, missed_pct: 0, avg_var: 67.6 },
    { route: "460", route_id: null, stopName: "I35W/Lake St E", stopId: 17780, day_of_week: null, direction: "North", n: 89, early_pct: 36, late_pct: 1.1, ontime_pct: 62.9, missed_pct: 0, avg_var: -37.2 },
    { route: "490", route_id: null, stopName: "2 Av S/10 St NE", stopId: 53307, day_of_week: null, direction: "North", n: 34, early_pct: 44.1, late_pct: 20.6, ontime_pct: 35.3, missed_pct: 0, avg_var: -32 },
    { route: "477", route_id: null, stopName: "I35W/Lake St E", stopId: 17780, day_of_week: null, direction: "North", n: 89, early_pct: 25.8, late_pct: 10.1, ontime_pct: 64, missed_pct: 0, avg_var: 29.2 },
    { route: "444", route_id: null, stopName: "Burnsville Tran", stopId: 31928, day_of_week: null, direction: "North", n: 282, early_pct: 41.5, late_pct: 11.3, ontime_pct: 46.8, missed_pct: 0.4, avg_var: 22.6 },
    { route: "470", route_id: null, stopName: "I35W/Lake St E", stopId: 17780, day_of_week: null, direction: "North", n: 34, early_pct: 20.6, late_pct: 0, ontime_pct: 79.4, missed_pct: 0, avg_var: 14.4 },
    { route: "444", route_id: null, stopName: "Burnsville Tran", stopId: 31928, day_of_week: null, direction: "South", n: 284, early_pct: 50.4, late_pct: 12.7, ontime_pct: 37, missed_pct: 0, avg_var: 0.7 },
  ],
};

export type CandidateStatus = "pending" | "approved" | "rejected";

export const PAGE_META: Record<string, { title: string; sub: string }> = {
  dashboard: { title: "Dashboard", sub: "Portfolio view across all routes and open review items" },
  queue: { title: "Review Queue", sub: "Approve or reject stops flagged for chronic early-departure bias" },
  routes: { title: "Route Summary", sub: "Official departure OTP vs. raw, compared to the 90% threshold" },
  weather: { title: "Weather Exclusions", sub: "Log and track weather/emergency service day exclusions" },
  monthly: { title: "Monthly Assessments", sub: "Locked OTP snapshots used for contractor assessment" },
  audit: { title: "Audit Stream", sub: "Full history of exclusion rule and finalization actions" },
  admin: { title: "Administration", sub: "Reason codes, roles, and detection thresholds" },
  tuner: { title: "Threshold Tuner", sub: "Preview candidate detection sensitivity changes" },
};

// Official OTP % for a route, excluding stops approved for exclusion.
// Takes the candidate array explicitly (rather than reading DATA.candidates
// directly) so the same function works whether candidates came from the
// mock DATA or a live Avail feed pull (see deriveCandidatesFromLive below).
export function computeOfficialPct(r: RouteRow, candidates: Candidate[], statuses: CandidateStatus[]): number {
  let excludedEvents = 0;
  let excludedOnTime = 0;
  candidates.forEach((c, i) => {
    if (c.route === r.route && statuses[i] === "approved") {
      excludedEvents += c.n;
      excludedOnTime += Math.round((c.n * c.ontime_pct) / 100);
    }
  });
  const newTotal = r.total - excludedEvents;
  const newOnTime = r.ontime - excludedOnTime;
  return newTotal > 0 ? Math.round((newOnTime / newTotal) * 1000) / 10 : r.pct_raw;
}

// A stop/route/day-of-week row is flagged for exclusion review when its
// early or late percentage exceeds this share of departures - a clear,
// obvious flag point (same convention as SpeedAlerts.tsx's fixed 50 mph
// threshold), not a tuned statistical model. This is now the fallback
// default only - the real, admin-editable value lives in OtpSettings
// (otpSettings.ts) and is fetched at runtime; the Threshold Tuner page lets
// staff preview a different value before applying it.
export const DEFAULT_EARLY_LATE_BIAS_THRESHOLD = 0.15;

// Builds the Review Queue's candidate list from a live OTP Monthly feed
// pull - any stop/route/day-of-week row whose early or late share exceeds
// `threshold`. The feed has no per-record average-seconds-variance figure,
// so it's a placeholder here. `threshold` is a parameter (not the module
// constant above) so the Threshold Tuner can preview a different value
// against the same already-fetched stop rows with no new fetch.
export function deriveCandidatesFromLive(
  stops: OtpMonthlyStopRow[],
  threshold: number = DEFAULT_EARLY_LATE_BIAS_THRESHOLD,
): Candidate[] {
  return stops
    .filter((s) => (s.pct_early ?? 0) > threshold || (s.pct_late ?? 0) > threshold)
    .map((s) => ({
      // Must match deriveRouteRowsFromLive's route_label-first convention
      // exactly, or computeOfficialPct's c.route === r.route match silently
      // never fires for any route that has a label (which is most of them).
      route: s.route_label ?? String(s.route_id),
      route_id: s.route_id,
      stopName: s.stop_name ?? `Stop ${s.stop_id}`,
      stopId: s.stop_id,
      day_of_week: s.day_of_week,
      direction: "—",
      n: s.total ?? 0,
      early_pct: Math.round((s.pct_early ?? 0) * 1000) / 10,
      late_pct: Math.round((s.pct_late ?? 0) * 1000) / 10,
      ontime_pct: Math.round((s.pct_ontime ?? 0) * 1000) / 10,
      missed_pct: Math.round((s.pct_missed ?? 0) * 1000) / 10,
      avg_var: null,
    }));
}

// Builds the Route Summary/Dashboard's per-route rows from a live OTP
// Monthly feed pull's route rollup.
export function deriveRouteRowsFromLive(routes: OtpMonthlyRouteRollup[]): RouteRow[] {
  return routes.map((r) => ({
    route: r.route_label ?? String(r.route_id),
    total: r.total,
    ontime: r.ontime,
    pct_raw: r.pct_ontime !== null ? Math.round(r.pct_ontime * 1000) / 10 : 0,
  }));
}

// Composite key matching OtpStopExclusions' unique constraint - used to
// look up a candidate's persisted review decision.
export function stopExclusionKey(routeId: number | null, stopId: number, dayOfWeek: string | null): string {
  return `${routeId ?? "mock"}-${stopId}-${dayOfWeek ?? "mock"}`;
}
