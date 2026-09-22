// Putting the server's OTP measurement into words and rows.
//
// The figures themselves are decided once, on the server
// (functions-restapi/src/lib/otpMonth, ADR 0033): fixed-route service only,
// minus approved Stop Exclusions, against the target the month is judged by.
// This file only formats them. It used to be otherwise - the browser
// recomputed its own "official" percentage from rows it had flagged itself,
// and compared it against a hardcoded 85, so Route Summary and the Dashboard
// could disagree with each other and with the contractor's assessment.
import type { FlaggedStop, OtpMonthMeasurement, OtpRouteFigure, OtpTargetSource } from "@mvta/shared";
import type { RouteRow } from "./otpData.js";

export interface OtpDisplayRoute {
  key: string;
  label: string;
  /** Every departure the feed holds for the route. */
  departures: number;
  rawPct: number | null;
  /** Official Departure OTP. Null when nothing on this route is measured. */
  officialPct: number | null;
  /** Percentage points the exclusions and the route filter moved it. */
  deltaPoints: number | null;
  status: "below" | "meets" | "not_measured";
  /** Why a route is not measured, for the reader who expects to see it. */
  note: string | null;
}

const asPercent = (share: number | null | undefined): number | null =>
  share === null || share === undefined ? null : Math.round(share * 1000) / 10;

const CATEGORY_NOTES: Record<string, string> = {
  SpecialEvent: "Special-event service — outside the fixed-route standard",
  OnDemand: "On-demand service — outside the fixed-route standard",
  NonRevenue: "Non-revenue service — carries no passengers",
};

export function displayRoute(route: OtpRouteFigure): OtpDisplayRoute {
  const rawPct = asPercent(route.raw.pct);
  const officialPct = asPercent(route.assessable.pct);
  return {
    key: String(route.route_id),
    label: route.route_label ?? String(route.route_id),
    departures: route.raw.departures,
    rawPct,
    officialPct,
    deltaPoints: officialPct === null || rawPct === null ? null : Math.round((officialPct - rawPct) * 10) / 10,
    status: route.below_target === null ? "not_measured" : route.below_target ? "below" : "meets",
    note: route.below_target === null
      ? CATEGORY_NOTES[route.route_category] ?? "Every departure on this route is excluded"
      : null,
  };
}

export function displayRoutes(measurement: OtpMonthMeasurement): OtpDisplayRoute[] {
  return measurement.routes.map(displayRoute);
}

/**
 * The same rows from the sample data shown before a feed is configured. The
 * preview has no exclusions and no classification behind it, so it shows the
 * raw figure and says so rather than inventing an official one.
 */
export function previewRoutes(rows: RouteRow[], targetPct: number): OtpDisplayRoute[] {
  return rows.map((row) => ({
    key: row.route,
    label: row.route,
    departures: row.total,
    rawPct: row.pct_raw,
    officialPct: null,
    deltaPoints: null,
    status: row.pct_raw < targetPct ? "below" : "meets",
    note: "Sample data — no exclusions applied",
  }));
}

/** What the target rests on, for the reader comparing two months. */
export function targetSentence(targetPct: number, source: OtpTargetSource = "catalog"): string {
  const target = `${Math.round(targetPct * 10) / 10}%`;
  if (source === "period_rule_set") return `Target ${target}, from this month's assessment rules.`;
  if (source === "catalog") return `Target ${target}, from the current performance standard.`;
  return `Target ${target}: Attachment G's figure, used because no performance standard is configured.`;
}

/**
 * Weather days are recorded and deliberately not applied: Avail's monthly feed
 * is aggregated by day of week, not by date, so removing one date would mean
 * removing every Monday in the month (ADR 0033).
 */
/**
 * What the month's weather and emergency days are doing to the figure.
 *
 * Until ADR 0038 the answer was always "nothing", and this sentence said so:
 * Avail's monthly feed is grouped by day of week, so a single date could not
 * be taken out of it. An approved date now subtracts the departures frozen
 * from the daily feed when it was approved, so the sentence has to tell the
 * two states apart - a recorded day that nobody approved still moves nothing,
 * and saying otherwise would overstate what the figure has been adjusted for.
 */
export function weatherSentence(recorded: number, applied = 0): string {
  if (recorded === 0) return "No weather or emergency days are recorded for this month.";
  const days = recorded === 1 ? "1 day is" : `${recorded} days are`;
  if (applied === 0) {
    return `${days} recorded for this month. None is approved, so none is removed from the OTP figures — approving a day subtracts the departures it carried.`;
  }
  const subtracting = applied === 1 ? "1 is approved and subtracting" : `${applied} are approved and subtracting`;
  const rest = applied < recorded
    ? ` The other ${recorded - applied === 1 ? "day is" : `${recorded - applied} days are`} recorded but not approved, so ${recorded - applied === 1 ? "it changes" : "they change"} nothing.`
    : "";
  return `${days} recorded for this month, and ${subtracting} its departures from the official figure.${rest} Raw OTP is left as Avail published it.`;
}

export const percentText = (pct: number | null): string => pct === null ? "—" : `${pct}%`;

/** A Flagged Stop as the Review Queue renders it. Percentages, not shares. */
export interface QueueRow {
  key: string;
  routeLabel: string;
  stopName: string;
  stopId: number;
  dayOfWeek: string;
  /** Departures the flag was worked out over. */
  sampled: number;
  earlyPct: number;
  ontimePct: number;
  latePct: number;
  missedPct: number;
  /** Which way the stop leans - the reason it is in front of a reviewer. */
  biasLabel: "Early-biased" | "Late-biased";
}

/**
 * The server decides which stops are here and in what order (ADR 0034); this
 * only turns one into the row the queue draws. The monthly feed has no
 * average-seconds variance, so the lean is read off the shares themselves -
 * which is what the queue displayed for every live row anyway.
 */
export function queueRow(stop: FlaggedStop): QueueRow {
  return {
    key: `${stop.route_id}-${stop.stop_id}-${stop.day_of_week}`,
    routeLabel: stop.route_label ?? String(stop.route_id),
    stopName: stop.stop_name ?? `Stop ${stop.stop_id}`,
    stopId: stop.stop_id,
    dayOfWeek: stop.day_of_week,
    sampled: stop.total,
    earlyPct: asPercent(stop.pct_early) ?? 0,
    ontimePct: asPercent(stop.pct_ontime) ?? 0,
    latePct: asPercent(stop.pct_late) ?? 0,
    missedPct: asPercent(stop.pct_missed) ?? 0,
    biasLabel: stop.pct_early > stop.pct_late ? "Early-biased" : "Late-biased",
  };
}
