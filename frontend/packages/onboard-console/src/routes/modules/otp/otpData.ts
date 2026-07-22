// OTP Compliance module data (mock).
// TODO: replace DATA with the module's Dev SQL source (route OTP + candidate
// stops). Reason codes are static config.

export interface RouteRow {
  route: string;
  total: number;
  ontime: number;
  pct_raw: number;
}

export interface Candidate {
  route: string;
  stopName: string;
  stopId: number;
  direction: string;
  n: number;
  early_pct: number;
  late_pct: number;
  ontime_pct: number;
  missed_pct: number;
  avg_var: number;
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
    { route: "490", stopName: "Wash/Coffman SW", stopId: 13209, direction: "North", n: 34, early_pct: 32.4, late_pct: 44.1, ontime_pct: 23.5, missed_pct: 0, avg_var: 164 },
    { route: "470", stopName: "Eagan TS", stopId: 30535, direction: "South", n: 34, early_pct: 20.6, late_pct: 35.3, ontime_pct: 44.1, missed_pct: 0, avg_var: 144.7 },
    { route: "490", stopName: "12 St/Hennep. S", stopId: 19332, direction: "North", n: 34, early_pct: 52.9, late_pct: 11.8, ontime_pct: 35.3, missed_pct: 0, avg_var: -132.2 },
    { route: "477", stopName: "2 Av S/10 St NE", stopId: 53307, direction: "North", n: 89, early_pct: 19.1, late_pct: 15.7, ontime_pct: 65.2, missed_pct: 0, avg_var: 85.2 },
    { route: "470", stopName: "2 Av S/10 St NE", stopId: 53307, direction: "North", n: 34, early_pct: 17.6, late_pct: 8.8, ontime_pct: 73.5, missed_pct: 0, avg_var: 67.6 },
    { route: "460", stopName: "I35W/Lake St E", stopId: 17780, direction: "North", n: 89, early_pct: 36, late_pct: 1.1, ontime_pct: 62.9, missed_pct: 0, avg_var: -37.2 },
    { route: "490", stopName: "2 Av S/10 St NE", stopId: 53307, direction: "North", n: 34, early_pct: 44.1, late_pct: 20.6, ontime_pct: 35.3, missed_pct: 0, avg_var: -32 },
    { route: "477", stopName: "I35W/Lake St E", stopId: 17780, direction: "North", n: 89, early_pct: 25.8, late_pct: 10.1, ontime_pct: 64, missed_pct: 0, avg_var: 29.2 },
    { route: "444", stopName: "Burnsville Tran", stopId: 31928, direction: "North", n: 282, early_pct: 41.5, late_pct: 11.3, ontime_pct: 46.8, missed_pct: 0.4, avg_var: 22.6 },
    { route: "470", stopName: "I35W/Lake St E", stopId: 17780, direction: "North", n: 34, early_pct: 20.6, late_pct: 0, ontime_pct: 79.4, missed_pct: 0, avg_var: 14.4 },
    { route: "444", stopName: "Burnsville Tran", stopId: 31928, direction: "South", n: 284, early_pct: 50.4, late_pct: 12.7, ontime_pct: 37, missed_pct: 0, avg_var: 0.7 },
  ],
};

export const reasonCodes: [string, string][] = [
  ["SCHED_RECOVERY", "Scheduled recovery / layover"],
  ["TERMINAL_HOLD", "Terminal / station hold"],
  ["NON_REVENUE", "Non-revenue stop"],
  ["SCHEDULE_DESIGN", "Schedule design issue"],
  ["DATA_QUALITY", "Data quality issue"],
  ["OTHER", "Other"],
];

export const dateReasonCodes: [string, string][] = [
  ["WEATHER_SNOW", "Snow event"],
  ["WEATHER_ICE", "Ice event"],
  ["WEATHER_FLOOD", "Flooding"],
  ["EMERGENCY_ROAD", "Emergency road closure"],
  ["DECLARED_EMERGENCY", "Declared emergency"],
  ["OTHER", "Other"],
];

export type CandidateStatus = "pending" | "approved" | "rejected";

export interface DateExclusion {
  scope: "Agency" | "Route";
  route: string | null;
  date: string;
  reason: string;
  notes: string;
  status: "Approved" | "Proposed";
  notified: boolean;
  notifiedDate: string | null;
  acknowledged: boolean;
}

export const INITIAL_DATE_EXCLUSIONS: DateExclusion[] = [
  { scope: "Agency", route: null, date: "2026-01-12", reason: "WEATHER_SNOW", notes: "Metro-wide snow emergency, all routes on winter detour", status: "Approved", notified: true, notifiedDate: "2026-01-13", acknowledged: true },
  { scope: "Route", route: "490", date: "2026-02-03", reason: "EMERGENCY_ROAD", notes: "CR11 bridge closure rerouted Route 490 for the day", status: "Approved", notified: true, notifiedDate: "2026-02-05", acknowledged: false },
];

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
export function computeOfficialPct(r: RouteRow, statuses: CandidateStatus[]): number {
  let excludedEvents = 0;
  let excludedOnTime = 0;
  DATA.candidates.forEach((c, i) => {
    if (c.route === r.route && statuses[i] === "approved") {
      excludedEvents += c.n;
      excludedOnTime += Math.round((c.n * c.ontime_pct) / 100);
    }
  });
  const newTotal = r.total - excludedEvents;
  const newOnTime = r.ontime - excludedOnTime;
  return newTotal > 0 ? Math.round((newOnTime / newTotal) * 1000) / 10 : r.pct_raw;
}
