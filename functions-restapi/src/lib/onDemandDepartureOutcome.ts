// How one on-demand duty departure is judged.
//
// The on-demand counterpart of fixedRouteDepartureOutcome.ts. The rule lives
// in lib/garageDeparture, declared once and rendered both ways; this file
// stays so GET /on-demand-departures keeps its import.
//
// The row-level no_departure flag that endpoint computes against the database
// clock is still not consulted: a duty is judged once its service day is over,
// the same as a fixed-route run, so that a candidate is never raised against a
// duty that is still in progress.
export {
  type OnDemandDepartureJudgement,
  type OnDemandDepartureOutcome,
  isJudged,
  onDemandDepartureOutcome,
} from "./garageDeparture";
