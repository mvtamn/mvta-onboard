// The Review Queue's unit of work: one stop on one route, with every weekday
// the server flagged it on.
//
// A Flagged Stop is a stop, on one route, on one day of the week (ADR 0034),
// and the decision is recorded at that grain - one OtpStopExclusions row per
// stop-day. But a reviewer does not think at that grain. "Oak St SE is a
// recovery point" is one judgement about one place, and October 2026 put it
// in front of the reviewer fifteen times: three routes, five weekdays each,
// scattered through a 348-row list ordered by lean. This file folds the
// server's list into the 96 route/stop pairs it actually contains, so one
// decision can cover a stop's week while any day can still be carved out.
//
// The server's order is kept: a group sits where its worst day sat, so the
// queue still reads worst first. Days inside a group run Monday to Sunday,
// which is how a schedule is read, not by lean.
import type { FlaggedStop, OtpStopExclusion } from "@mvta/shared";
import type { StopExclusionStatus } from "./otpData.js";
import type { QueueRow } from "./otpFigures.js";

export interface QueueDay {
  stop: FlaggedStop;
  row: QueueRow;
  status: StopExclusionStatus;
  /** Monday-first short label for the chip; the feed's own spelling stays on the row. */
  dayLabel: string;
  /** The weekday written out, for a tooltip or a screen reader. */
  dayName: string;
  previous: OtpStopExclusion | undefined;
}

export interface QueueGroup {
  key: string;
  routeLabel: string;
  stopName: string;
  stopId: number;
  /** Monday to Sunday. */
  days: QueueDay[];
  /** Departures across every flagged day. */
  sampled: number;
  /** The week's adherence, each day weighted by its departures. Percentages. */
  earlyPct: number;
  ontimePct: number;
  latePct: number;
  missedPct: number;
  biasLabel: "Early-biased" | "Late-biased" | "Early some days, late others";
  pending: number;
  approved: number;
  rejected: number;
  /** Other routes the same stop is flagged on this month, for the reviewer who knows it as one place. */
  otherRoutes: string[];
}

const WEEK = [
  ["mo", "Mon", "Monday"],
  ["tu", "Tue", "Tuesday"],
  ["we", "Wed", "Wednesday"],
  ["th", "Thu", "Thursday"],
  ["fr", "Fri", "Friday"],
  ["sa", "Sat", "Saturday"],
  ["su", "Sun", "Sunday"],
] as const;

/**
 * Where a feed day falls in the week. The monthly feed writes "Mon", "Tues",
 * "Thur"; older rows and tests write the day out. Anything unrecognised sorts
 * last and keeps its own spelling.
 */
export function weekdayIndex(dayOfWeek: string): number {
  const head = dayOfWeek.trim().slice(0, 2).toLowerCase();
  const i = WEEK.findIndex(([prefix]) => prefix === head);
  return i === -1 ? WEEK.length : i;
}

const dayLabel = (dayOfWeek: string): string => WEEK[weekdayIndex(dayOfWeek)]?.[1] ?? dayOfWeek;
const dayName = (dayOfWeek: string): string => WEEK[weekdayIndex(dayOfWeek)]?.[2] ?? dayOfWeek;

export const groupKey = (stop: FlaggedStop): string => `${stop.route_id}-${stop.stop_id}`;

export function queueGroups(
  stops: readonly FlaggedStop[],
  rows: readonly QueueRow[],
  statusOf: (stop: FlaggedStop) => StopExclusionStatus,
  previousDecisionFor: (stop: FlaggedStop) => OtpStopExclusion | undefined,
): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  const routesByStop = new Map<number, Set<string>>();

  stops.forEach((stop, i) => {
    const row = rows[i];
    if (!row) return;
    const key = groupKey(stop);
    let group = groups.get(key);
    if (!group) {
      group = {
        key, routeLabel: row.routeLabel, stopName: row.stopName, stopId: row.stopId,
        days: [], sampled: 0, earlyPct: 0, ontimePct: 0, latePct: 0, missedPct: 0,
        biasLabel: row.biasLabel, pending: 0, approved: 0, rejected: 0, otherRoutes: [],
      };
      groups.set(key, group);
    }
    const status = statusOf(stop);
    group.days.push({
      stop, row, status,
      dayLabel: dayLabel(stop.day_of_week),
      dayName: dayName(stop.day_of_week),
      previous: previousDecisionFor(stop),
    });
    group.sampled += row.sampled;
    group[status] += 1;
    if (row.biasLabel !== group.biasLabel) group.biasLabel = "Early some days, late others";

    let routes = routesByStop.get(stop.stop_id);
    if (!routes) routesByStop.set(stop.stop_id, (routes = new Set()));
    routes.add(row.routeLabel);
  });

  for (const group of groups.values()) {
    const weight = group.sampled || 1;
    const weighted = (pick: (row: QueueRow) => number) =>
      Math.round(group.days.reduce((sum, d) => sum + pick(d.row) * d.row.sampled, 0) / weight * 10) / 10;
    group.earlyPct = weighted((r) => r.earlyPct);
    group.ontimePct = weighted((r) => r.ontimePct);
    group.latePct = weighted((r) => r.latePct);
    group.missedPct = weighted((r) => r.missedPct);
    group.days.sort((a, b) =>
      weekdayIndex(a.stop.day_of_week) - weekdayIndex(b.stop.day_of_week)
      || a.stop.day_of_week.localeCompare(b.stop.day_of_week));
    group.otherRoutes = [...(routesByStop.get(group.stopId) ?? [])]
      .filter((r) => r !== group.routeLabel)
      .sort();
  }
  return [...groups.values()];
}

export interface QueueFilter {
  route: string;
  status: "pending" | "all" | "resolved";
  search: string;
}

export function matchesFilter(group: QueueGroup, filter: QueueFilter): boolean {
  if (filter.route && group.routeLabel !== filter.route) return false;
  if (filter.status === "pending" && group.pending === 0) return false;
  if (filter.status === "resolved" && group.pending > 0) return false;
  const needle = filter.search.trim().toLowerCase();
  if (needle && !group.stopName.toLowerCase().includes(needle) && !String(group.stopId).includes(needle)) return false;
  return true;
}

/** What last month decided for these days, in one line, or null when it decided none of them. */
export function previousSummary(
  days: readonly QueueDay[],
  reasonLabel: (code: string) => string,
): string | null {
  const decided = days.filter((d) => d.previous);
  if (decided.length === 0) return null;
  const excluded = decided.filter((d) => d.previous!.status === "approved");
  const kept = decided.length - excluded.length;
  if (kept === 0) {
    const reasons = new Set(excluded.map((d) => d.previous!.reason_code ?? ""));
    const code = reasons.size === 1 ? [...reasons][0]! : "";
    return `Last month: excluded${code ? ` \u2014 ${reasonLabel(code)}` : ""}`;
  }
  if (excluded.length === 0) return "Last month: kept in the figure";
  return `Last month: ${excluded.length} excluded, ${kept} kept`;
}

/** What is already decided for a group whose days are all decided, in one line. */
export function decidedSummary(
  group: QueueGroup,
  reasonOf: (stop: FlaggedStop) => string,
  reasonLabel: (code: string) => string,
): string {
  const excluded = group.days.filter((d) => d.status === "approved");
  if (excluded.length === group.days.length) {
    const reasons = new Set(excluded.map((d) => reasonOf(d.stop)));
    const one = reasons.size === 1 ? [...reasons][0] : null;
    return `Excluded${one ? ` \u2014 ${reasonLabel(one)}` : ""}`;
  }
  if (excluded.length === 0) return "Kept in OTP calc";
  return `${excluded.length} of ${group.days.length} days excluded`;
}
