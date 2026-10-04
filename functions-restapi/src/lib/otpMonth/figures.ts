// The arithmetic of a month's figures: what a share is, what came out, and
// whether a route met its target.
//
// This is the part a contractor is actually assessed on, and until now none of
// it could be checked without standing up a SQL Server - it lived as private
// helpers inside measureOtpMonth, reachable only through the db contract test.
// ADR 0038 then added the stop/date split to the same untested code.
//
// Pure functions over numbers. The rows come from otpRouteFiguresSql; nothing
// here knows where they came from.
import type { OtpFigure, OtpRouteFigure } from "./types";

/** A share of departures. Null where there is nothing to divide by. */
export function figure(departures: number, ontime: number): OtpFigure {
  return { departures, ontime, pct: departures > 0 ? ontime / departures : null };
}

/** One route's row as the measurement query returns it. */
export interface RouteRow {
  service_month: string;
  route_id: number;
  route_label: string | null;
  route_category: string;
  raw_total: number;
  raw_ontime: number;
  /** After the category and stop-exclusion rules, before any date exclusion. */
  before_dates_total: number;
  before_dates_ontime: number;
  total: number;
  ontime: number;
}

/**
 * Per-route figures, with the two exclusion rules told apart.
 *
 * A reviewer asking why a route moved is owed the difference between "a stop
 * came out" and "a snow day came out", so `excluded` is reported alongside the
 * two halves that make it up. The halves are differences between successive
 * stages of the same query, which is why they cannot double-count: a row the
 * stop rule already removed is not in `before_dates` for the date rule to
 * remove again.
 *
 * `below_target` is null, not false, where a route has no assessable
 * departures. A route the standard does not cover has not met its target and
 * has not missed it; saying "meets" would put a special-event shuttle in the
 * same column as a route that genuinely hit 95%.
 */
export function routeFigures(rows: readonly RouteRow[], target: number): OtpRouteFigure[] {
  return rows.map((row) => {
    const raw = figure(Number(row.raw_total), Number(row.raw_ontime));
    const beforeDates = figure(Number(row.before_dates_total), Number(row.before_dates_ontime));
    const assessable = figure(Number(row.total), Number(row.ontime));
    const excluded = figure(raw.departures - assessable.departures, raw.ontime - assessable.ontime);
    const stopExcluded = figure(raw.departures - beforeDates.departures, raw.ontime - beforeDates.ontime);
    const dateExcluded = figure(beforeDates.departures - assessable.departures, beforeDates.ontime - assessable.ontime);
    return {
      route_id: row.route_id,
      route_label: row.route_label,
      route_category: row.route_category,
      raw,
      excluded,
      assessable,
      stop_excluded: stopExcluded,
      date_excluded: dateExcluded,
      below_target: assessable.pct === null ? null : assessable.pct < target,
    };
  });
}

/** The agency line: one of the per-route figures summed across every route. */
export function total(routes: readonly OtpRouteFigure[], pick: (route: OtpRouteFigure) => OtpFigure): OtpFigure {
  return figure(
    routes.reduce((sum, route) => sum + pick(route).departures, 0),
    routes.reduce((sum, route) => sum + pick(route).ontime, 0),
  );
}
