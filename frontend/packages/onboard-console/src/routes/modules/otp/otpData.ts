// Sample route rows for the OTP Compliance module, shown before the Avail
// feed has anything for a month, plus the key a review decision is matched by.
//
// What used to live here and does not any more:
//
//   computeOfficialPct recomputed Official Departure OTP in the browser from
//   rows it had flagged itself, against a hardcoded 85. The server measures it
//   now and the console displays it (ADR 0033, otpFigures.ts).
//
//   deriveCandidatesFromLive decided which stop rows the Review Queue showed,
//   over every row the API shipped, at a DEFAULT_EARLY_LATE_BIAS_THRESHOLD of
//   its own - while the server stored and served a threshold it never read.
//   The server decides Flagged Stops now (ADR 0034), and GET /otp-monthly
//   returns them.
//
//   DATA.candidates was eleven invented stop rows for preview mode. Approving
//   one did nothing but flip local state, because there was no real row to
//   persist against - a Review Queue that taught a reviewer the wrong thing
//   about the one page whose purpose is recording real decisions. Before a
//   feed is populated the queue now says so.

export interface RouteRow {
  route: string;
  total: number;
  ontime: number;
  pct_raw: number;
}

export const DATA: { routes: RouteRow[] } = {
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
};

/**
 * Where a Flagged Stop's review stands. "pending" is the absence of a row in
 * OtpStopExclusions, not a stored value - a stop has no row there until staff
 * actually approve or reject it.
 */
export type StopExclusionStatus = "pending" | "approved" | "rejected";

export const PAGE_META: Record<string, { title: string; sub: string }> = {
  dashboard: { title: "Dashboard", sub: "Portfolio view across all routes and open review items" },
  queue: { title: "Review Queue", sub: "Approve or reject stops flagged for chronic early-departure bias" },
  routes: { title: "Route Summary", sub: "Official departure OTP vs. raw, compared to the contract target" },
  weather: { title: "Weather Exclusions", sub: "Log and track weather/emergency service day exclusions" },
  monthly: { title: "Monthly Assessments", sub: "Locked OTP snapshots used for contractor assessment" },
  audit: { title: "Audit Stream", sub: "Full history of exclusion rule and finalization actions" },
};

// Composite key matching OtpStopExclusions' unique constraint - used to
// look up a Flagged Stop's persisted review decision.
export function stopExclusionKey(routeId: number | null, stopId: number, dayOfWeek: string | null): string {
  return `${routeId ?? "mock"}-${stopId}-${dayOfWeek ?? "mock"}`;
}
