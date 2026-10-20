// What a check is: a definition the reader sees and a pure evaluation over one
// route of the schedule model. Adding a check is one file here plus one line in
// index.ts; its evidence rows are declared beside its number so the console
// never has to work out what a flag meant.
import type { ModelPattern, RouteModel, ScheduleModel } from "../feedModel";
import type { PredictionRiskCheckDefinition, ReviewEvidence } from "../types";

export interface CheckOutcome {
  value: number | null;
  evidence: ReviewEvidence[];
}

export interface CheckModule {
  definition: PredictionRiskCheckDefinition;
  evaluate(route: RouteModel, model: ScheduleModel): CheckOutcome;
}

/** Rows per check kept in the detail; the text of the last row says what was cut. */
export const EVIDENCE_ROWS = 25;
/** Trip ids per row; the count carries the rest. */
export const EVIDENCE_TRIPS = 10;

export function evidence(
  text: string,
  over: Partial<Pick<ReviewEvidence, "count" | "value" | "stop_ids" | "trip_ids">> = {},
): ReviewEvidence {
  return {
    text,
    count: over.count ?? null,
    value: over.value ?? null,
    stop_ids: over.stop_ids ?? [],
    trip_ids: (over.trip_ids ?? []).slice(0, EVIDENCE_TRIPS),
  };
}

/** The first rows of an already-sorted list, with one closing row naming the rest. */
export function capped(rows: ReviewEvidence[], what: string): ReviewEvidence[] {
  if (rows.length <= EVIDENCE_ROWS) return rows;
  const shown = rows.slice(0, EVIDENCE_ROWS - 1);
  shown.push(evidence(`${rows.length - shown.length} more ${what} not shown`, { count: rows.length - shown.length }));
  return shown;
}

export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((100 * part) / whole);
}

export function round(value: number, places = 0): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function pairText(model: ScheduleModel, fromStopId: string, toStopId: string): string {
  return `${model.stopName(fromStopId)} → ${model.stopName(toStopId)}`;
}

export function patternText(model: ScheduleModel, pattern: ModelPattern): string {
  return `${pairText(model, pattern.firstStopId, pattern.lastStopId)} (${pattern.stopCount} stops)`;
}

export function tripsWord(n: number): string {
  return n === 1 ? "1 trip" : `${n.toLocaleString()} trips`;
}
